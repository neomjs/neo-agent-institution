import Neo         from './node_modules/neo.mjs/src/Neo.mjs';
import * as core   from './node_modules/neo.mjs/src/core/_export.mjs';
import ServiceBase from './node_modules/neo.mjs/src/worker/ServiceBase.mjs';

/**
 * @summary The workspace's service-worker entry — the one thread a consumer build resolves from the
 * workspace root instead of the engine package, so that a workspace can own its caching rules.
 *
 * No app here sets `useServiceWorker` today; the entry exists because the engine's thread build
 * compiles all seven threads, and without it the build has to run in the engine's own framework
 * mode — which compiles every app and example the engine ships into this workspace's output.
 * @class AgentOS.ServiceWorker
 * @extends Neo.worker.ServiceBase
 * @singleton
 */
class ServiceWorker extends ServiceBase {
    static config = {
        /**
         * @member {String} className='AgentOS.ServiceWorker'
         * @protected
         */
        className: 'AgentOS.ServiceWorker',
        /**
         * @member {Boolean} singleton=true
         * @protected
         */
        singleton: true,
        /**
         * Names the cache: a new value retires the assets cached under the previous one.
         * @member {String} version='0.1.0'
         */
        version: '0.1.0'
    }

    /**
     * @member {String} workerId='service'
     * @protected
     */
    workerId = 'service'
}

export default Neo.setupClass(ServiceWorker);
