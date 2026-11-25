"""Serve the current build on an OS-allocated loopback port for one test run."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys

if __name__ == "__main__":
    handler = partial(SimpleHTTPRequestHandler, directory=Path(__file__).resolve().parents[1] / "app/dist")
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        Path(sys.argv[1]).write_text(str(server.server_port))
        server.serve_forever()
