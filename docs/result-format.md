# Result format

`result.json` is the contract between C++ and Electron. It contains backend
identity, input dimensions, runtime configuration, phase timings, output size
and compression ratio, plus official decoder, pixel and SHA-256 validation
flags. The JSON schema is kept in
`benchmark/schemas/benchmark-result.schema.json`.
