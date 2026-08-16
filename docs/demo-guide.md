# Demo guide

1. Build the native full target with CMake (`windows-full` on the development
   machine); this includes Serial, OpenMP, CUDA and MPI.
2. Start `dashboard` with `pnpm dev`.
3. Upload a PNG/BMP, choose a ready backend, then click **Convert image**.
4. Confirm the decoded preview and green pixel validation status.
5. Save the `.qoi` file, then use **Compare** to run multiple available
   backends sequentially.
