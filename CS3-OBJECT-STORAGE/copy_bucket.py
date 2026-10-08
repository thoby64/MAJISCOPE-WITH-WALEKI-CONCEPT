#!/usr/bin/env python3
"""Copy one S3-compatible bucket to another, verifying every object by SHA-256."""

from __future__ import annotations

import argparse
import hashlib
import os
import sys

import boto3
from botocore.config import Config


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Required environment variable is not set: {name}")
    return value


def client(prefix: str):
    return boto3.client(
        "s3",
        endpoint_url=required(f"{prefix}_ENDPOINT_URL"),
        region_name=os.environ.get(f"{prefix}_REGION", "garage"),
        aws_access_key_id=required(f"{prefix}_ACCESS_KEY_ID"),
        aws_secret_access_key=required(f"{prefix}_SECRET_ACCESS_KEY"),
        config=Config(s3={"addressing_style": "path"}, signature_version="s3v4"),
    )


def iter_keys(s3_client, bucket: str):
    for page in s3_client.get_paginator("list_objects_v2").paginate(Bucket=bucket):
        for item in page.get("Contents", []):
            yield item["Key"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Copy and verify objects; default only inventories")
    args = parser.parse_args()

    source_bucket = required("CS3_SOURCE_BUCKET")
    target_bucket = required("CS3_TARGET_BUCKET")
    source, target = client("CS3_SOURCE_S3"), client("CS3_TARGET_S3")
    object_count = sum(1 for _ in iter_keys(source, source_bucket))
    print(f"Source inventory: objects={object_count}; apply={args.apply}")
    if not args.apply:
        print("Dry run only. Add --apply to copy objects and verify target readback checksums.")
        return 0

    copied = 0
    for key in iter_keys(source, source_bucket):
        result = source.get_object(Bucket=source_bucket, Key=key)
        try:
            payload = result["Body"].read()
        finally:
            result["Body"].close()
        digest = hashlib.sha256(payload).hexdigest()
        target.put_object(
            Bucket=target_bucket,
            Key=key,
            Body=payload,
            ContentType=result.get("ContentType", "application/octet-stream"),
        )
        verify = target.get_object(Bucket=target_bucket, Key=key)
        try:
            copied_payload = verify["Body"].read()
        finally:
            verify["Body"].close()
        if hashlib.sha256(copied_payload).hexdigest() != digest:
            raise RuntimeError(f"SHA-256 readback mismatch for object key {key!r}")
        copied += 1
        print(f"Verified object {copied}/{object_count}")

    print(f"Copy complete: copied={copied}; source objects were retained.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Bucket copy failed: {exc.__class__.__name__}: {exc}", file=sys.stderr)
        raise SystemExit(1)
