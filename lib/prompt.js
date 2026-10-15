'use strict';
/**
 * Line prompts for setup. Questions and secrets share one readline interface,
 * so a secret is read up to Enter like any answer: a separate raw 'data'
 * listener used to take only the first keystroke and leave the rest (echoed)
 * for the next question. While a secret is read, the echo is muted.
 */
const readline = require('readline');
const { Writable } = require('stream');

function createPrompter({ input = process.stdin, output = process.stdout, terminal = Boolean(output.isTTY) } = {}) {
  let muted = false;
  const sink = new Writable({
    write(chunk, enc, cb) {
      if (!muted) output.write(chunk, enc);
      cb();
    },
  });
  const rl = readline.createInterface({ input, output: sink, terminal });

  const question = q => new Promise(resolve => rl.question(q, resolve));

  async function ask(q, def = '') {
    const ans = await question(def ? `${q} [${def}]: ` : `${q}: `);
    return ans.trim() || def;
  }

  async function askSecret(q) {
    output.write(`${q}: `);
    muted = true;
    try {
      return (await question('')).trim();
    } finally {
      muted = false;
      output.write('\n');
    }
  }

  return { ask, askSecret, close: () => rl.close() };
}

module.exports = { createPrompter };
