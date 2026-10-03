"""Execute the workflow's restore shell with a controlled release download."""
import gzip
import os
from pathlib import Path
import shutil
import subprocess

import pytest
import yaml


BASH = "C:/Program Files/Git/bin/bash.exe" if os.name == "nt" else shutil.which("bash")
pytestmark = pytest.mark.skipif(not BASH or not Path(BASH).exists(), reason="bash required")


def restore(tmp_path, *, download_status=0, full_rebuild="false", corrupt=False):
    workflow = Path(__file__).resolve().parents[2] / ".github/workflows/daily_forecast.yml"
    steps = yaml.safe_load(workflow.read_text())["jobs"]["forecast"]["steps"]
    step = next(s for s in steps if s.get("name") == "Restore the warehouse")
    assert not step.get("continue-on-error", False)
    (tmp_path / "restore.sh").write_text(step["run"], newline="\n")
    (tmp_path / "bin").mkdir()
    shim = tmp_path / "bin/gh"
    shim.write_text('#!/usr/bin/env bash\nif [ "$DOWNLOAD_STATUS" != 0 ]; then exit "$DOWNLOAD_STATUS"; fi\ncp asset.gz "$WAREHOUSE_DIR/warehouse.sqlite.gz"\n', newline="\n")
    shim.chmod(0o755)
    (tmp_path / "asset.gz").write_bytes(b"corrupt" if corrupt else gzip.compress(b"saved snapshot history"))
    env = dict(os.environ, DOWNLOAD_STATUS=str(download_status), FULL_REBUILD=full_rebuild,
               GITHUB_ENV="workflow.env", WAREHOUSE_DIR="restore-temp")
    # Resolve the temporary shim inside bash, including Windows drive paths.
    result = subprocess.run([BASH, "-e", "-o", "pipefail", "-c",
                             'export PATH="$PWD/bin:$PATH"; source restore.sh'],
                            cwd=tmp_path, env=env, capture_output=True, text=True)
    return result


def test_successful_restore_preserves_history(tmp_path):
    result = restore(tmp_path)
    assert result.returncode == 0, result.stderr
    assert (tmp_path / "backend/data/warehouse.sqlite").read_bytes() == b"saved snapshot history"
    assert not (tmp_path / "workflow.env").exists()


@pytest.mark.parametrize("status", [1, 2, 22])
def test_download_failure_stops_scheduled_publication(tmp_path, status):
    result = restore(tmp_path, download_status=status)
    assert result.returncode != 0
    assert "Forecast publication stopped" in result.stdout
    assert not (tmp_path / "workflow.env").exists()
    assert not (tmp_path / "backend/data/warehouse.sqlite").exists()


def test_explicit_recovery_can_request_full_build(tmp_path):
    result = restore(tmp_path, download_status=1, full_rebuild="true")
    assert result.returncode == 0, result.stderr
    assert (tmp_path / "workflow.env").read_text().strip() == "NEEDS_FULL_BUILD=true"


def test_corrupt_asset_stops_publication(tmp_path):
    result = restore(tmp_path, corrupt=True)
    assert result.returncode != 0
    assert not (tmp_path / "backend/data/warehouse.sqlite").exists()
    assert not (tmp_path / "workflow.env").exists()
