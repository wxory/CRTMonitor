import fs from 'fs';
import moment from 'moment';
import chalk from 'chalk';
import { isSea, getAsset } from 'node:sea';

export function time() {
    return moment().format('YYYY/MM/DD HH:mm:ss');
}

export async function sleep(n) {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve();
        }, n);
    });
}

export let log = {
    info(...msg) {
        console.log(chalk.cyan(time()), chalk.bold('[Info]'), ...msg);
    },
    error(...msg) {
        console.error(chalk.cyan(time()), chalk.red.bold('[Error]'), ...msg);
    },
    warn(...msg) {
        console.log(chalk.cyan(time()), chalk.yellow.bold('[Warn]'), ...msg);
    },
    success(...msg) {
        console.log(chalk.cyan(time()), chalk.green.bold('[Success]'), ...msg);
    },
    direct(...msg) {
        console.log(chalk.magenta(...msg));
    },
    title(...msg) {
        console.log(chalk.cyan.bold(...msg));
    },
    line() {
        console.log();
    },
};

export function asset(name) {
    if (isSea()) {
        return getAsset(name, 'UTF-8');
    } else {
        return fs.readFileSync(name);
    }
}
