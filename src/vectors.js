'use strict';
// Known-answer test vectors, used by the unit tests AND by experiment E0.
// Every value below was copied from the source document named next to it.

// RFC 4493, section 4 (AES-CMAC with AES-128). https://www.rfc-editor.org/rfc/rfc4493.txt
const RFC4493_KEY = '2b7e151628aed2a6abf7158809cf4f3c';
const RFC4493_MSG = '6bc1bee22e409f96e93d7e117393172a'
  + 'ae2d8a571e03ac9c9eb76fac45af8e51'
  + '30c81c46a35ce411e5fbc1191a0a52ef'
  + 'f69f2445df4f9b17ad2b417be66c3710';
const RFC4493_SUBKEYS = {
  key: RFC4493_KEY,
  L: '7df76b0c1ab899b33e42f047b91b546f', // AES-128(K, 0^128)
  K1: 'fbeed618357133667c85e08f7236a8de',
  K2: 'f7ddac306ae266ccf90bc11ee46d513b',
};
const RFC4493 = [
  { name: 'Example 1: empty message', key: RFC4493_KEY, message: '', cmac: 'bb1d6929e95937287fa37d129b756746' },
  { name: 'Example 2: 16 bytes', key: RFC4493_KEY, message: RFC4493_MSG.slice(0, 32), cmac: '070a16b46b4d4144f79bdd9dd04a287c' },
  { name: 'Example 3: 40 bytes', key: RFC4493_KEY, message: RFC4493_MSG.slice(0, 80), cmac: 'dfa66747de9ae63030ca32611497c827' },
  { name: 'Example 4: 64 bytes', key: RFC4493_KEY, message: RFC4493_MSG, cmac: '51f0bebf7e3b9d92fc49741779363cfe' },
];

// NXP AN12196 Rev. 2.0 (4 March 2025), "NTAG 424 DNA and NTAG 424 DNA TagTamper
// features and hints". SDMReadCtr is written LSB first in the note
// (e.g. "3D0000" = 0x00003D = 61).
const AN12196 = [
  {
    name: 'AN12196 Table 1 (SDM session key generation)',
    key: '5ACE7E50AB65D5D51FD5BF5A16B8205B',
    uid: '04C767F2066180',
    counter: 0x000001, // "010000" LSB first
    sv2: '3CC30001008004C767F2066180010000',
    sessionKey: '3A3E8110E05311F7A3FCF0D969BF2B48',
  },
  {
    name: 'AN12196 Table 4 (SDMMAC, zero-length MAC input)',
    key: '00000000000000000000000000000000',
    uid: '04DE5F1EACC040',
    counter: 0x00003d, // "3D0000" LSB first
    sv2: '3CC30001008004DE5F1EACC0403D0000',
    sessionKey: '3FB5F6E3A807A03D5E3570ACE393776F',
    macInput: '',
    sdmMac: '94EED9EE65337086',
  },
  {
    name: 'AN12196 Table 5 (SDMMAC over "CEE9...8962&cmac=")',
    key: '00000000000000000000000000000000',
    uid: '04958CAA5C5E80',
    counter: 0x000008, // "080000" LSB first
    sv2: '3CC30001008004958CAA5C5E80080000',
    sessionKey: '3ED0920E5E6A0320D823D5987FEAFBB1',
    macInput: 'CEE9A53E3E463EF1F459635736738962&cmac=',
    fullCmac: '81EC45C175E72FF6FAC61BC7AB3BAEF6',
    sdmMac: 'ECC1E7F6C6C73BF6',
  },
];

module.exports = { RFC4493, RFC4493_SUBKEYS, AN12196 };
