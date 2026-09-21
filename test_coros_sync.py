import asyncio
import datetime
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from coros_sync import Coros, download_and_generate
from generator import Generator
from generator.db import Activity


class CorosSyncTest(unittest.TestCase):
    def test_login_uses_instance_options(self):
        async def check():
            transport = httpx.MockTransport(
                lambda request: httpx.Response(
                    200, json={"data": {"accessToken": "test"}}
                )
            )
            client = httpx.AsyncClient
            with patch(
                "coros_sync.httpx.AsyncClient",
                side_effect=lambda **kw: client(transport=transport, **kw),
            ):
                coros = Coros("account", "hashed-password", is_only_running=True)
                await coros.init()
                self.assertTrue(coros.is_only_running)
                await coros.req.aclose()

        asyncio.run(check())

    def test_failed_activity_list_is_not_empty_success(self):
        async def check():
            coros = Coros("account", "password")
            coros.req = AsyncMock()
            coros.req.get.return_value = httpx.Response(
                200,
                json={"result": "999", "message": "expired"},
                request=httpx.Request(
                    "GET", "https://teamcnapi.coros.com/activity/query"
                ),
            )
            with self.assertRaises(RuntimeError):
                await coros.fetch_activity_ids_types(False)

        asyncio.run(check())

    def test_pagination_accepts_successful_empty_page_and_skips_history(self):
        async def check():
            coros = Coros("account", "password")
            coros.req = AsyncMock()
            request = httpx.Request("GET", "https://teamcnapi.coros.com/activity/query")
            coros.req.get.side_effect = [
                httpx.Response(
                    200,
                    request=request,
                    json={
                        "result": "0000",
                        "data": {
                            "dataList": [
                                {
                                    "labelId": 1,
                                    "sportType": 100,
                                    "startTime": 1788036393000,
                                },
                                {
                                    "labelId": 2,
                                    "sportType": 100,
                                    "startTime": 1788295593,
                                },
                            ]
                        },
                    },
                ),
                httpx.Response(
                    200,
                    request=request,
                    json={
                        "result": "0000",
                        "data": {"count": 2, "pageNumber": 2, "totalPage": 1},
                    },
                ),
            ]
            self.assertEqual(
                await coros.fetch_activity_ids_types(False, {1788036393}), [["2", 100]]
            )

        asyncio.run(check())

    def test_download_retries_only_failed_files(self):
        async def check():
            coros = AsyncMock()
            coros.fetch_activity_ids_types.return_value = [["1", 100], ["2", 100]]
            attempts = {}

            async def download(label_id, *args):
                attempts[label_id] = attempts.get(label_id, 0) + 1
                if label_id == "1" and attempts[label_id] == 1:
                    return None, None
                return label_id, label_id + ".fit"

            coros.download_activity.side_effect = download
            with (
                patch("coros_sync.Coros", return_value=coros),
                patch("coros_sync.Generator"),
                patch("coros_sync.get_downloaded_ids", return_value=[]),
                patch("coros_sync.make_activities_file") as generated,
                patch("coros_sync.asyncio.sleep", new_callable=AsyncMock),
            ):
                await download_and_generate("account", "password", False, "fit")
                self.assertEqual(attempts, {"1": 2, "2": 1})
                generated.assert_called_once()

        asyncio.run(check())

    def test_coros_import_preserves_strava_history(self):
        with tempfile.TemporaryDirectory() as folder:
            generator = Generator(str(Path(folder) / "test.db"))
            generator.session.add(
                Activity(
                    run_id=123,
                    name="Original Strava title",
                    start_date="2026-08-29 20:46:33+00:00",
                )
            )
            generator.session.commit()

            def track(run_id, start):
                activity = SimpleNamespace(
                    id=run_id,
                    name="COROS",
                    type="Run",
                    subtype="",
                    start_date=start,
                    start_date_local=start,
                    start_latlng=None,
                    location_country="",
                    distance=1000,
                    moving_time=datetime.timedelta(minutes=5),
                    elapsed_time=datetime.timedelta(minutes=5),
                    average_heartrate=130,
                    average_speed=3.3,
                    elevation_gain=0,
                    map=None,
                )
                return SimpleNamespace(
                    file_names=[str(run_id)], to_namedtuple=lambda **kw: activity
                )

            tracks = [
                track(1000, "2026-08-29 20:46:33"),
                track(2000, "2026-09-01 20:46:33"),
            ]
            with (
                patch(
                    "generator.track_loader.TrackLoader.load_tracks",
                    return_value=tracks,
                ),
                patch("generator.save_synced_data_file_list") as saved,
            ):
                generator.sync_from_data_dir(
                    folder, "fit", deduplicate_by_start_time=True
                )
                generator.sync_from_data_dir(
                    folder, "fit", deduplicate_by_start_time=True
                )
                self.assertEqual(generator.session.query(Activity).count(), 2)
                self.assertEqual(
                    generator.session.get(Activity, 123).name, "Original Strava title"
                )
                self.assertEqual(saved.call_args.args[0], ["1000", "2000"])
            generator.session.close()


if __name__ == "__main__":
    unittest.main()
