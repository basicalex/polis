# Dev institutional seal (M12 — §15.7)

**DEV ONLY — NOT LEGALLY MEANINGFUL.** This P-256 ECDSA self-signed certificate +
key pair is the committed dev material `DssSignerClient` (`SIGNATURE_MODE=real`)
uses to produce a real CMS/PKCS#7 e-seal over a proof manifest hash. It exists so
the real-adapter path is cryptographically genuine without a backing DSS/TSP
service; the obvious "NOT LEGALLY MEANINGFUL" CN label is required by §15.7
("test keys are allowed with obvious labels").

- `dev-institutional-seal.crt` — self-signed dev cert (CN: *Polis Interface DEV
  Institutional Seal (NOT LEGALLY MEANINGFUL)*, O: *Polis Interface DEV*), 10y.
- `dev-institutional-seal.key` — the matching EC P-256 private key.

Production swaps this material for a real institutional seal behind the same
`SIGNATURE_MODE=real` seam (override with `SIGNATURE_DEV_CERT_PATH` /
`SIGNATURE_DEV_KEY_PATH`). Regenerate with:

```sh
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
  -keyout dev-institutional-seal.key -out dev-institutional-seal.crt \
  -days 3650 -nodes \
  -subj "/CN=Polis Interface DEV Institutional Seal (NOT LEGALLY MEANINGFUL)/O=Polis Interface DEV"
```
