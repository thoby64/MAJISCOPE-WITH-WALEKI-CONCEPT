#!/usr/bin/env python3
"""Copy a legacy S3 bucket to the Python storage API and verify every object."""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
import sys
from typing import BinaryIO
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Required environment variable is not set: {name}")
    return value


def source_client():
    try:
        import boto3
        from botocore.config import Config
    except ImportError as exc:
        raise RuntimeError("Install requirements.txt to run the legacy S3 migration") from exc

    return boto3.client(
        "s3",
        endpoint_url=required("CS3_SOURCE_S3_ENDPOINT_URL"),
        region_name=os.environ.get("CS3_SOURCE_S3_REGION", "garage"),
        aws_access_key_id=required("CS3_SOURCE_S3_ACCESS_KEY_ID"),
        aws_secret_access_key=required("CS3_SOURCE_S3_SECRET_ACCESS_KEY"),
        config=Config(s3={"addressing_style": "path"}, signature_version="s3v4"),
    )


def iter_objects(s3_client, bucket: str):
    for page in s3_client.get_paginator("list_objects_v2").paginate(Bucket=bucket):
        for item in page.get("Contents", []):
            yield item


def upload_and_hash(
    api_url: str,
    token: str,
    key: str,
    source_body: BinaryIO,
    size: int,
    content_type: str,
) -> str:
    target = urlsplit(api_url)
    if (
        target.scheme not in {"http", "https"}
        or not target.hostname
        or target.query
        or target.fragment
        or target.username
        or target.password
    ):
        raise RuntimeError("CS3_TARGET_STORAGE_API_URL must be an HTTP(S) URL")
    connection_type = http.client.HTTPSConnection if target.scheme == "https" else http.client.HTTPConnection
    connection = connection_type(target.hostname, target.port, timeout=120)
    path = f"{target.path.rstrip('/')}/internal/objects/{quote(key, safe='/')}"
    if not path.startswith("/"):
        path = f"/{path}"
    digest = hashlib.sha256()
    remaining = size
    try:
        connection.putrequest("PUT", path)
        connection.putheader("Authorization", f"Bearer {token}")
        connection.putheader("Content-Type", content_type)
        connection.putheader("Content-Length", str(size))
        connection.putheader("Connection", "close")
        connection.endheaders()
        while remaining:
            chunk = source_body.read(min(1024 * 1024, remaining))
            if not chunk:
                raise RuntimeError("Legacy source ended before the object was fully read")
            connection.send(chunk)
            digest.update(chunk)
            remaining -= len(chunk)
        response = connection.getresponse()
        response_body = response.read()
        if response.status not in {200, 201}:
            raise RuntimeError(f"Storage API upload failed with status {response.status}")
        result = json.loads(response_body)
        if result.get("sha256") != digest.hexdigest():
            raise RuntimeError("Storage API upload checksum mismatch")
        return digest.hexdigest()
    finally:
        connection.close()


def verify_target(api_url: str, token: str, key: str, expected_digest: str) -> None:
    url = f"{api_url.rstrip('/')}/internal/objects/{quote(key, safe='/')}"
    request = Request(url, headers={"Authorization": f"Bearer {token}"})
    digest = hashlib.sha256()
    try:
        with urlopen(request, timeout=120) as response:
            while chunk := response.read(1024 * 1024):
                digest.update(chunk)
    except HTTPError as exc:
        raise RuntimeError(f"Storage API readback failed with status {exc.code}") from exc
    except URLError as exc:
        raise RuntimeError("Could not read the copied object from the Python storage API") from exc
    if digest.hexdigest() != expected_digest:
        raise RuntimeError("Storage API readback checksum mismatch")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Copy and verify objects; default only inventories")
    args = parser.parse_args()

    source_bucket = required("CS3_SOURCE_BUCKET")
    target_url = required("CS3_TARGET_STORAGE_API_URL")
    target_token = required("CS3_TARGET_STORAGE_API_KEY")
    source = source_client()
    object_count = sum(1 for _ in iter_objects(source, source_bucket))
    print(f"Source inventory: objects={object_count}; apply={args.apply}")
    if not args.apply:
        print("Dry run only. Add --apply to copy objects and verify target readback checksums.")
        return 0

    for index, item in enumerate(iter_objects(source, source_bucket), start=1):
        key = item["Key"]
        result = source.get_object(Bucket=source_bucket, Key=key)
        try:
            content_type = result.get("ContentType", "application/octet-stream")
            if "\r" in content_type or "\n" in content_type:
                content_type = "application/octet-stream"
            digest = upload_and_hash(
                target_url,
                target_token,
                key,
                result["Body"],
                int(result["ContentLength"]),
                content_type,
            )
        finally:
            result["Body"].close()
        verify_target(target_url, target_token, key, digest)
        print(f"Verified object {index}/{object_count}")

    print(f"Copy complete: copied={object_count}; legacy source objects were retained.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Bucket migration failed: {exc.__class__.__name__}: {exc}", file=sys.stderr)
        raise SystemExit(1)
