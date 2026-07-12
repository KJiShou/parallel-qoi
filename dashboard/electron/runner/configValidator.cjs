const BACKENDS = new Set(['serial','openmp','cuda','mpi']);
const SIZES = new Set([500,1000,2000,4000]);
const STEPS = new Set([100,500,1000]);
const DENSITIES = new Set([0.6,0.7,0.8]);
const THREADS = new Set([1,2,4,8,16]);
const PROCESSES = new Set([1,2,4,8]);
const BLOCKS = new Set([128,256,512,1024]);
function integer(value,name){ if(!Number.isInteger(value)) throw new Error(`${name} must be an integer`); return value; }
function validateConfig(raw, capabilities={cudaBlockSizes:BLOCKS}) {
  if(!raw || typeof raw!=='object') throw new Error('Run configuration must be an object');
  const backend=raw.backend; if(!BACKENDS.has(backend)) throw new Error('Unsupported backend');
  const rows=integer(raw.rows,'rows'), cols=integer(raw.cols,'cols'); if(rows!==cols||!SIZES.has(rows)) throw new Error('Grid must be a supported square size');
  const steps=integer(raw.steps,'steps'); if(!STEPS.has(steps)) throw new Error('Unsupported timestep count');
  const density=Number(raw.density); if(!DENSITIES.has(density)) throw new Error('Unsupported density');
  const seed=integer(raw.seed,'seed'); const repetitions=integer(raw.repetitions,'repetitions'); if(![1,3,5].includes(repetitions)) throw new Error('Unsupported repetitions');
  const out={backend,rows,cols,steps,density,seed,repetitions};
  if(backend==='openmp'){out.threads=integer(raw.threads,'threads'); if(!THREADS.has(out.threads)) throw new Error('Unsupported OpenMP thread count');}
  if(backend==='mpi'){out.processes=integer(raw.processes,'processes'); if(!PROCESSES.has(out.processes)||out.processes>rows) throw new Error('Unsupported MPI process count');}
  if(backend==='cuda'){out.blockSize=integer(raw.blockSize,'blockSize'); const allowed=new Set(capabilities.cudaBlockSizes||BLOCKS); if(!allowed.has(out.blockSize)) throw new Error('Unsupported CUDA block size');}
  return Object.freeze(out);
}
module.exports={validateConfig};
