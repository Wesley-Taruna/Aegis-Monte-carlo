'use strict';
// Tag model: NXP NTAG 424 DNA TT Secure Dynamic Messaging (SDM / "SUN" message).
//
// Follows NXP application note AN12196, "SUN MAC" calculation:
//   1. Session vector  SV2 = 3C C3 00 01 00 80 || UID (7 bytes) || SDMReadCtr (3 bytes, least significant byte first)
//   2. Session key     KSesSDMFileReadMAC = AES-CMAC(K_SDMFileReadMAC, SV2)
//   3. Full MAC        CMAC16 = AES-CMAC(KSesSDMFileReadMAC, MAC input bytes)
//   4. Truncated MAC   SDMMAC = the 8 bytes at positions 1, 3, 5, ..., 15 of CMAC16 (64 bits)
//
// MODELING ASSUMPTIONS (marked in config/default.json too):
//   * Plaintext mirroring: the UID and counter appear as plain hex text in the
//     URL (not the encrypted PICCData mode).
//   * The MAC input is the ASCII text of the URL between the UID mirror and the
//     MAC mirror (SDMMACInputOffset .. SDMMACOffset - 1).
//   * DEPLOYMENT REQUIREMENT, per the NT4H2421Tx data sheet Rev. 3.0
//     (Sec. 9.3.4-9.3.5): the tamper status is mirrored at TTStatusOffset, and the
//     MAC protects it only if the tag is configured with TTStatusOffset inside
//     that range. `tamperInMac = true` models such a tag; false models a tag
//     configured without it.
//   * Simplification: the real chip mirrors two ASCII characters,
//     TTPermStatus || TTCurrStatus, each C (closed), O (open) or I (invalid:
//     tamper feature not enabled). We mirror one character, "C" or "O", and
//     assume the feature is enabled.
//   * The counter is mirrored as 6 hex digits, most significant first.

const { aesCmac, createCmac } = require('./cmac');

const SV2_PREFIX = Buffer.from([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80]);
const MAX_COUNTER = 0xffffff; // the read counter is 24 bits

// Build SV2 from UID and counter (AN12196).
function sessionVector(uid, counter) {
  if (uid.length !== 7) throw new Error('UID must be 7 bytes');
  const ctr = Buffer.from([counter & 0xff, (counter >>> 8) & 0xff, (counter >>> 16) & 0xff]); // LSB first
  return Buffer.concat([SV2_PREFIX, uid, ctr]);
}

// KSesSDMFileReadMAC. `tagCmac` is a reusable CMAC function for the tag key
// (see createCmac) or a raw 16-byte key.
function sessionMacKey(tagKeyOrCmac, uid, counter) {
  const sv2 = sessionVector(uid, counter);
  return typeof tagKeyOrCmac === 'function' ? tagKeyOrCmac(sv2) : aesCmac(tagKeyOrCmac, sv2);
}

// AN12196 truncation: keep the odd-indexed bytes (1, 3, ..., 15) -> 8 bytes.
function truncateSdm(cmac16) {
  const out = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) out[i] = cmac16[2 * i + 1];
  return out;
}

// The 8-byte SDM MAC for one (UID, counter, MAC input).
function sdmMac(tagKeyOrCmac, uid, counter, macInput) {
  const kSes = sessionMacKey(tagKeyOrCmac, uid, counter);
  return truncateSdm(aesCmac(kSes, macInput));
}

// Shorten an 8-byte MAC to its first `bits` bits (for the guessing experiment).
// bits = 64 returns the MAC unchanged. Unused trailing bits are set to zero.
function truncateBits(mac8, bits) {
  if (bits < 1 || bits > 64) throw new Error('macBits must be between 1 and 64');
  const out = Buffer.from(mac8.subarray(0, Math.ceil(bits / 8)));
  const spare = out.length * 8 - bits;
  if (spare > 0) out[out.length - 1] &= (0xff << spare) & 0xff;
  return out;
}

function hex(buf) {
  return buf.toString('hex').toUpperCase();
}

function counterHex(counter) {
  return counter.toString(16).toUpperCase().padStart(6, '0');
}

// The bytes the MAC covers, given the plaintext-mirroring URL layout
//   ...?uid=<UID>&ctr=<CTR>&tt=<C|O>&mac=<MAC>          (tamperInMac = true)
//   ...?uid=<UID>&ctr=<CTR>&mac=<MAC>&tt=<C|O>          (tamperInMac = false)
// The MAC input runs from the start of the UID mirror up to the MAC mirror.
function macInputFor(uidHex, counter, tamperStatus, tamperInMac) {
  const tt = tamperStatus === 'open' ? 'O' : 'C';
  const text = tamperInMac
    ? `${uidHex}&ctr=${counterHex(counter)}&tt=${tt}&mac=`
    : `${uidHex}&ctr=${counterHex(counter)}&mac=`;
  return Buffer.from(text, 'ascii');
}

// The MAC a genuine tag (or a server holding the right key) computes for a
// message, as a hex string of `macBits` bits.
function computeMessageMac(tagCmac, uidBuf, counter, tamperStatus, { macBits, tamperInMac }) {
  const input = macInputFor(hex(uidBuf), counter, tamperStatus, tamperInMac);
  return hex(truncateBits(sdmMac(tagCmac, uidBuf, counter, input), macBits));
}

// A simulated physical tag. Every call to tap() increases the counter by one,
// whether or not the resulting message ever reaches the server.
class Tag {
  constructor({ uid, key, macBits = 64, tamperInMac = true }) {
    this.uid = Buffer.from(uid);
    this.uidHex = hex(this.uid);
    this.key = Buffer.from(key);
    this.cmac = createCmac(this.key);
    this.counter = 0;
    this.tamperStatus = 'closed';
    this.macParams = { macBits, tamperInMac };
  }

  // Break the seal (tamper loop). It cannot be closed again.
  openSeal() {
    this.tamperStatus = 'open';
  }

  // One NFC read. Returns the message the phone would see in the URL.
  tap() {
    if (this.counter >= MAX_COUNTER) throw new Error('24-bit read counter exhausted');
    this.counter += 1;
    return {
      uid: this.uidHex,
      counter: this.counter,
      tamperStatus: this.tamperStatus,
      mac: computeMessageMac(this.cmac, this.uid, this.counter, this.tamperStatus, this.macParams),
    };
  }
}

module.exports = {
  MAX_COUNTER,
  sessionVector,
  sessionMacKey,
  truncateSdm,
  sdmMac,
  truncateBits,
  macInputFor,
  computeMessageMac,
  counterHex,
  hex,
  Tag,
};
