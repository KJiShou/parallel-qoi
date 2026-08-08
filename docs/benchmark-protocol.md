# Benchmark protocol

Use one warm-up followed by five measured runs. Keep input decoding and file
writing outside encode-only timing. Run backends sequentially in Compare mode,
and use the Serial result as the speedup baseline. Publish hardware, compiler,
thread/process counts and whether MPI used one machine or multiple nodes.

