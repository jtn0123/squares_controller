# Security policy

## Supported versions

Security fixes are applied to the latest release on `main`.

## Deployment model

Squares Controller is intended for a trusted local network. It has no user
authentication and must not be exposed directly to the public internet.

- Keep the default `127.0.0.1` bind address for single-computer use.
- Do not port-forward TCP 4312 or UDP 7777.
- If you bind to `0.0.0.0`, use only a trusted private LAN.
- Keep `config.json` private. It is excluded from Git.

The controller accepts only private or link-local IPv4 targets to reduce the
risk of accidentally sending requests outside the LAN.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do
not include device tokens, private IP addresses, or network captures in a
public issue.
