#include "wildfire_common.hpp"
#include <mpi.h>
#include <cstdlib>
using namespace wildfire;

static int localIndex(int row, int col, int cols) { return row * cols + col; }
static int updateLocal(const std::vector<int>& grid, int row, int col, int localRows, int cols) {
    int state=grid[localIndex(row,col,cols)];
    if(state==EMPTY) return EMPTY; if(state==BURNED) return BURNED; if(state==BURNING) return BURNED;
    for(int dr=-1;dr<=1;++dr) for(int dc=-1;dc<=1;++dc){ if(dr==0&&dc==0) continue; int nr=row+dr,nc=col+dc; if(nr>=0&&nr<localRows+2&&nc>=0&&nc<cols&&grid[localIndex(nr,nc,cols)]==BURNING) return BURNING; }
    return TREE;
}

int main(int argc,char** argv){
    MPI_Init(&argc,&argv); int rank=0,size=1; MPI_Comm_rank(MPI_COMM_WORLD,&rank); MPI_Comm_size(MPI_COMM_WORLD,&size);
    try{
        SimulationConfig cfg=parseArgs(argc,argv,true);
        std::vector<int> rows(size),counts(size),displs(size); int base=cfg.rows/size,extra=cfg.rows%size,offset=0;
        for(int r=0;r<size;++r){ rows[r]=base+(r<extra?1:0); counts[r]=rows[r]*cfg.cols; displs[r]=offset*cfg.cols; offset+=rows[r]; }
        std::vector<int> full; if(rank==0) full=generateInitialGrid(cfg);
        std::vector<int> current((rows[rank]+2)*cfg.cols,EMPTY),next(current.size(),EMPTY);
        auto reset=[&](){ std::fill(current.begin(),current.end(),EMPTY); std::fill(next.begin(),next.end(),EMPTY); MPI_Scatterv(rank==0?full.data():nullptr,counts.data(),displs.data(),MPI_INT,&current[cfg.cols],counts[rank],MPI_INT,0,MPI_COMM_WORLD); };
        auto run=[&](){ for(int step=0;step<cfg.steps;++step){
            std::fill(current.begin(),current.begin()+cfg.cols,EMPTY); std::fill(current.begin()+(rows[rank]+1)*cfg.cols,current.end(),EMPTY);
            int up=rank==0?MPI_PROC_NULL:rank-1,down=rank==size-1?MPI_PROC_NULL:rank+1;
            MPI_Sendrecv(&current[cfg.cols],cfg.cols,MPI_INT,up,0,&current[(rows[rank]+1)*cfg.cols],cfg.cols,MPI_INT,down,0,MPI_COMM_WORLD,MPI_STATUS_IGNORE);
            MPI_Sendrecv(&current[rows[rank]*cfg.cols],cfg.cols,MPI_INT,down,1,&current[0],cfg.cols,MPI_INT,up,1,MPI_COMM_WORLD,MPI_STATUS_IGNORE);
            for(int r=1;r<=rows[rank];++r) for(int c=0;c<cfg.cols;++c) next[localIndex(r,c,cfg.cols)]=updateLocal(current,r,c,rows[rank],cfg.cols);
            current.swap(next);
        }};
        for(int i=0;i<cfg.warmup;++i){ reset(); run(); }
        std::vector<double> samples; std::vector<int> final;
        for(int rep=0;rep<cfg.repetitions;++rep){
            reset(); MPI_Barrier(MPI_COMM_WORLD); double start=MPI_Wtime(); run(); double local=MPI_Wtime()-start,elapsed=0;
            MPI_Reduce(&local,&elapsed,1,MPI_DOUBLE,MPI_MAX,0,MPI_COMM_WORLD); if(rank==0) samples.push_back(elapsed*1000.0);
            std::vector<int> owned(current.begin()+cfg.cols,current.begin()+(rows[rank]+1)*cfg.cols); if(rank==0) final.resize(cfg.rows*cfg.cols);
            MPI_Gatherv(owned.data(),counts[rank],MPI_INT,rank==0?final.data():nullptr,counts.data(),displs.data(),MPI_INT,0,MPI_COMM_WORLD);
        }
        if(rank==0){ auto timing=summarizeTimings(samples); writeSummary(cfg,"mpi",timing,final,size,0); std::cout<<"mpi result\nTime (ms): "<<timing.median<<"\nBurned cells: "<<countBurnedCells(final)<<"\nChecksum: "<<checksumGrid(final)<<"\nProcesses: "<<size<<"\n"; }
        MPI_Finalize(); return 0;
    }catch(const std::exception& ex){ if(rank==0) std::cerr<<"Error: "<<ex.what()<<"\n"; MPI_Abort(MPI_COMM_WORLD,2); return 2; }
}
