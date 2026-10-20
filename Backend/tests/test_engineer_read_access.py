from datetime import datetime

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import DMA, Engineer, Team, Utility
from app.security.auth import create_access_token


def _engineer_headers(engineer: Engineer) -> dict[str, str]:
    token = create_access_token(engineer.id, engineer.email)
    return {"Authorization": f"Bearer {token}"}


def _create_engineers(db: Session) -> tuple[Engineer, Engineer]:
    utility = Utility(name="Engineer access test utility")
    db.add(utility)
    db.flush()

    dma = DMA(name="Engineer access test DMA", utility_id=utility.id)
    db.add(dma)
    db.flush()

    team = Team(name="Engineer access test team", dma_id=dma.id)
    db.add(team)
    db.flush()

    engineers = [
        Engineer(
            name=f"Engineer {index}",
            email=f"engineer-{index}@example.com",
            password="test-hash",
            dma_id=dma.id,
            team_id=team.id,
            setup_completed_at=datetime.utcnow(),
        )
        for index in (1, 2)
    ]
    db.add_all(engineers)
    db.commit()
    for engineer in engineers:
        db.refresh(engineer)
    return engineers[0], engineers[1]


def test_engineer_can_read_own_record(
    client: TestClient,
    db: Session,
):
    engineer, _other_engineer = _create_engineers(db)

    response = client.get(
        f"/api/engineers/{engineer.id}",
        headers=_engineer_headers(engineer),
    )

    assert response.status_code == 200
    assert response.json()["id"] == engineer.id
    assert response.json()["team_name"] == "Engineer access test team"
    assert response.json()["dma_name"] == "Engineer access test DMA"


def test_engineer_cannot_read_another_engineers_record(
    client: TestClient,
    db: Session,
):
    engineer, other_engineer = _create_engineers(db)

    response = client.get(
        f"/api/engineers/{other_engineer.id}",
        headers=_engineer_headers(engineer),
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Access denied"
