'use strict';
/**
 * lib/modes/encrypt-config.js - --encrypt-config / --decrypt-config: at-rest encryption migration (moved from watcher.js).
 */
const { configErrorReason } = require('../config');

// -- --encrypt-config / --decrypt-config: at-rest encryption migration --------
async function run({ flags }) {
  const { ENCRYPT_CONFIG, KEEP_PLAINTEXT } = flags;
  const { encryptConfigToDisk, decryptConfigToDisk, getPassphrase, PASSPHRASE_ENV } = require('../config');
  if (!getPassphrase()) {
    console.error(`No passphrase. Create ~/.config/upec-wipe/passphrase (chmod 600), or set ${PASSPHRASE_ENV} or UPEC_WIPE_PASSPHRASE_FILE, and re-run.`);
    process.exit(1);
  }
  try {
    if (ENCRYPT_CONFIG) {
      const res = encryptConfigToDisk({ shred: !KEEP_PLAINTEXT });
      console.log(`\nEncrypted config written to ${res.encPath}`);
      console.log(res.shredded
        ? '   Plaintext config.json shredded.'
        : '   Plaintext config.json kept (--keep-plaintext).');
      console.log(`   Decrypt later with: node watcher.js --decrypt-config\n`);
    } else {
      const res = decryptConfigToDisk({ removeEnc: true });
      console.log(`\nDecrypted plaintext config written to ${res.configPath}`);
      console.log('   Encrypted config.json.enc removed.\n');
    }
    process.exit(0);
  } catch (err) {
    console.error(`Config migration failed: ${configErrorReason(err)}`);
    process.exit(1);
  }
}

module.exports = { run };
