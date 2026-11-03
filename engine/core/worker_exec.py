"""Set child-only resource limits, then replace this process with the media tool."""

import os
import sys


def main():
    if os.name == "posix":
        import resource

        for kind, amount in (
            (resource.RLIMIT_CPU, 1800),
            (resource.RLIMIT_FSIZE, 1024 * 1024 * 1024),
            (resource.RLIMIT_NOFILE, 256),
        ):
            resource.setrlimit(kind, (amount, amount))
        if sys.platform == "linux":
            resource.setrlimit(resource.RLIMIT_AS, (4 * 1024**3, 4 * 1024**3))
    os.execv(sys.argv[1], sys.argv[1:])


if __name__ == "__main__":
    main()
