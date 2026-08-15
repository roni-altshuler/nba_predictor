"""Make `from backend...` absolute imports work from the repo root.

Backend tests import absolutely (`from backend.services...`) so a test file
can be run from anywhere without a sys.path dance in each one.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
