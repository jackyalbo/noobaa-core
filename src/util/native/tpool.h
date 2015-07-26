#ifndef TPOOL_H_
#define TPOOL_H_

#include "common.h"
#include "mutex.h"

class ThreadPool : public node::ObjectWrap
{
public:
    explicit ThreadPool(int nthreads);
    virtual ~ThreadPool();

    void set_nthreads(int nthreads);
    int get_nthreads() {
        return _nthreads;
    }

    struct Worker
    {
        virtual ~Worker() {}
        virtual void work() = 0; // called from pooled thread
        virtual void after_work() = 0; // called on event loop
    };
    void submit(Worker* worker);

private:
    struct ThreadSpec
    {
        ThreadPool* tpool;
        int index;
        ThreadSpec(ThreadPool* tp, int i)
            : tpool(tp)
            , index(i)
        {
        }
    };
    void thread_main(ThreadSpec& spec);
    void completion_cb();
    static void thread_main_uv(void* arg);
    static void work_completed_uv(uv_async_t* async, int);

private:
    MutexCond _mutex;
    int _nthreads;
    uv_async_t _async_completion;
    std::list<uv_thread_t> _thread_ids;
    std::list<Worker*> _pending_workers;
    std::list<Worker*> _completed_workers;
    int _refs;

public:
    static void setup(v8::Handle<v8::Object> exports);

private:
    static v8::Persistent<v8::Function> _ctor;
    static NAN_METHOD(new_instance);
    static NAN_ACCESSOR_GETTER(nthreads_getter);
    static NAN_ACCESSOR_SETTER(nthreads_setter);
};

#endif // TPOOL_H_
