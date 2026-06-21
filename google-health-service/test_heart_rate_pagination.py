import extractor


class Credentials:
    token = "test"


class Response:
    ok = True
    status_code = 200
    text = ""

    def __init__(self, body):
        self._body = body

    def json(self):
        return self._body


def test_fetch_heart_rate_follows_next_page_token():
    calls = []

    def fake_get(url, headers, params, timeout):
        calls.append(params)
        point = {
            "heartRate": {
                "sampleTime": {"physicalTime": f"2026-06-21T08:00:0{len(calls)}Z"},
                "beatsPerMinute": 60 + len(calls),
            }
        }
        body = {"dataPoints": [point]}
        if len(calls) == 1:
            body["nextPageToken"] = "next"
        return Response(body)

    original_get = extractor.requests.get
    original_limit = extractor.HEART_RATE_PAGE_LIMIT
    try:
        extractor.requests.get = fake_get
        extractor.HEART_RATE_PAGE_LIMIT = 4
        points = extractor.fetch_heart_rate(
            Credentials(),
            {"start_date": "2026-06-21", "end_date": "2026-06-21"},
        )
    finally:
        extractor.requests.get = original_get
        extractor.HEART_RATE_PAGE_LIMIT = original_limit

    assert len(calls) == 2
    assert calls[1]["pageToken"] == "next"
    assert [point["value"] for point in points] == [61.0, 62.0]


if __name__ == "__main__":
    test_fetch_heart_rate_follows_next_page_token()
    print("ok")
