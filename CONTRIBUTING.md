# Contributing

Thanks for your interest in improving the Archally Blueprint schema and tooling.

## Licensing of contributions (inbound = outbound, plus relicensing grant)

This repository is dual-licensed (see [LICENSE](./LICENSE)). To keep the project
maintainable and to preserve the maintainer's ability to steward the licensing,
by submitting a contribution (a pull request, patch, or any change) you agree
that:

1. Your contribution is licensed to the project and its users under the **same
   license that governs the file(s) you change** — the Apache License, Version
   2.0 for Apache-licensed areas, and the Functional Source License 1.1
   (ALv2 Future License) for FSL-licensed areas (see the map in `LICENSE`).

2. You additionally grant Adam Walkowski / Archally a perpetual, worldwide,
   non-exclusive, royalty-free, irrevocable license to use, reproduce, and
   **relicense** your contribution as part of the project, including the right
   to release it under different or additional license terms in the future.
   This lets the maintainer, for example, offer a commercial license for the
   FSL-covered tooling or adjust the licensing map without collecting new
   permissions from every contributor.

3. You have the right to grant these licenses (the contribution is your own
   work, or you are authorized to submit it), and it does not knowingly infringe
   anyone's rights.

## Developer Certificate of Origin (DCO)

Sign off every commit to certify the above (`git commit -s`), which appends:

    Signed-off-by: Your Name <your.email@example.com>

The text you certify is the Developer Certificate of Origin 1.1
(https://developercertificate.org/).

## Where changes go

| Area | License | Notes |
| --- | --- | --- |
| `schema/`, `examples/`, `docs/`, `tools/validator/` | Apache-2.0 | The open format and its reference conformance tooling. |
| `tools/model-builder`, `tools/semantic-checker`, `tools/renderer`, `tools/schema-update`, `tools/schema-atlas` | FSL-1.1-ALv2 | The value-add tooling. |

If a change would move the boundary between these areas, raise it in an issue
first.
