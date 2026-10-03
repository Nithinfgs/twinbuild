# Security Policy

## What twinbuild does

`twinbuild` copies your project to a temporary directory and executes the build command **you give it**, twice. It has no network code of its own and no runtime dependencies. Only run it on projects you would be willing to build normally: a build script can do anything your user can do.

## Supported versions

The latest release on `main` receives fixes.

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** (Security tab, "Report a vulnerability") rather than a public issue. Include the version, a description, and steps to reproduce. You can expect an acknowledgement within a few days.

In scope: path traversal or unsafe file handling in workspace copy/cleanup, archive parsing issues (tar/zip) triggered by malicious build output, and anything that makes temporary files outlive the run unexpectedly.

Out of scope: arbitrary code execution by the build command itself (that is the tool's purpose).
