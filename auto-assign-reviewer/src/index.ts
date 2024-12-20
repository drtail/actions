import { run } from './run';
import * as core from '@actions/core';


run().then(() => {
    core.info("Done")
}).catch(e => {
    core.error(e)
    core.setFailed(e.message)
})