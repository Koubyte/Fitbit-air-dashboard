import os
import tempfile

os.environ["MOBILE_INGEST_PATH"] = os.path.join(tempfile.gettempdir(), "fitbit-mobile-ingest-test.json")

from fastapi.testclient import TestClient
from main import app


def test_mobile_ingest_merges_into_live_payload():
    try:
        os.remove(os.environ["MOBILE_INGEST_PATH"])
    except FileNotFoundError:
        pass

    client = TestClient(app)
    payload = {
        "source": "test",
        "heart_rate": [
            {"timestamp": "2026-06-18T21:34:31Z", "value": 65},
            {"timestamp": "2026-06-18T21:50:00Z", "value": 72},
        ],
    }

    ingest = client.post("/api/mobile-ingest", json=payload)
    assert ingest.status_code == 200
    assert ingest.json()["heart_rate_received"] == 2

    live = client.get("/api/health-data")
    assert live.status_code == 200
    data = live.json()
    assert data["heart_rate"][-1]["timestamp"] == "2026-06-18T21:50:00Z"
    assert data["heart_rate"][-1]["value"] == 72
    assert len(data["mobile_heart_rate"]) == 2


if __name__ == "__main__":
    test_mobile_ingest_merges_into_live_payload()
    print("ok")
