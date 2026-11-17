'use strict';
// E0 Correctness: AES-CMAC vs RFC 4493, and SDM MAC vs AN12196, byte for byte.
// No randomness; this must pass before any other experiment is reported.

const { aesCmac, subkeysFor } = require('../cmac');
const { sessionVector, sessionMacKey, truncateSdm, hex } = require('../sdm');
const { RFC4493, RFC4493_SUBKEYS, AN12196 } = require('../vectors');

function run() {
  const rows = [];
  const check = (suite, name, expected, got) => {
    const e = expected.toUpperCase();
    rows.push({ suite, name, expected: e, got, pass: got === e });
  };

  // RFC 4493: subkeys, then the four examples.
  const sk = subkeysFor(Buffer.from(RFC4493_SUBKEYS.key, 'hex'));
  check('RFC 4493', 'Subkey generation: AES-128(K, 0)', RFC4493_SUBKEYS.L, hex(sk.L));
  check('RFC 4493', 'Subkey generation: K1', RFC4493_SUBKEYS.K1, hex(sk.K1));
  check('RFC 4493', 'Subkey generation: K2', RFC4493_SUBKEYS.K2, hex(sk.K2));
  for (const v of RFC4493) {
    check('RFC 4493', v.name, v.cmac, hex(aesCmac(Buffer.from(v.key, 'hex'), Buffer.from(v.message, 'hex'))));
  }

  // AN12196 Rev. 2.0: SV2, session key, and (where given) full and truncated MAC.
  for (const v of AN12196) {
    const key = Buffer.from(v.key, 'hex');
    const uid = Buffer.from(v.uid, 'hex');
    check('AN12196', `${v.name}: SV2`, v.sv2, hex(sessionVector(uid, v.counter)));
    const kSes = sessionMacKey(key, uid, v.counter);
    check('AN12196', `${v.name}: KSesSDMFileReadMAC`, v.sessionKey, hex(kSes));
    if (v.sdmMac) {
      const full = aesCmac(kSes, Buffer.from(v.macInput, 'ascii'));
      if (v.fullCmac) check('AN12196', `${v.name}: full CMAC`, v.fullCmac, hex(full));
      check('AN12196', `${v.name}: SDMMAC (truncated)`, v.sdmMac, hex(truncateSdm(full)));
    }
  }
  return {
    id: 'E0',
    title: 'E0 Correctness (known-answer tests)',
    rows,
    allPass: rows.every((r) => r.pass),
    notes: [
      'RFC 4493 values copied from rfc-editor.org/rfc/rfc4493.txt, section 4.',
      'AN12196 values copied from NXP AN12196 Rev. 2.0 (4 March 2025), Tables 1, 4 and 5.',
    ],
  };
}

module.exports = { run };
