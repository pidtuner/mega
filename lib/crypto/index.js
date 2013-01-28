exports.formatKey = function(key) {
  if (typeof key === 'string') {
    return new Buffer(exports.base64Clean(key), 'base64')
  }
  return key
}

// MEGA API uses a variation of base64 with -_ instead of +/
// and the trailing = stripped
exports.base64Addons = function(s) {
  return s.replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')
}

exports.base64Clean = function(s) {
  s += '=='.substr((2-s.length*3)&3)
  return s.replace(/\-/g,'+').replace(/_/g,'/').replace(/,/g,'')
}


function AES(key) {
  var sjcl = require('./sjcl')
  var a32 = []
  for (var i = 0; i < 4; i++) a32[i] = key.readInt32BE(i * 4)
  this.aes = new sjcl.aes(a32)
}

// encrypt Buffer in CBC mode (zero IV)
AES.prototype.encrypt_cbc = function (buffer) {
  var iv = [0,0,0,0], d = Array(4);
  var i, j;

  for (i = 0; i < buffer.length; i += 16)
  {
    for (j = 0; j < 4; j++) {
      d[j] = buffer.readUInt32BE(i + j * 4, false) ^ iv[j]
    }
    iv = this.aes.encrypt(d);

    for (j = 0; j < 4; j++) {
      buffer.writeInt32BE(iv[j], i + j * 4, false)
    }
  }
}

// decrypt Buffer in CBC mode (zero IV)
AES.prototype.decrypt_cbc = function (buffer) {
  var iv = [0,0,0,0], d = Array(4), t = Array(4);
  var i, j;

  for (i = 0; i < buffer.length; i += 16) {
    for (j = 0; j < 4; j++) {
      d[j] = buffer.readUInt32BE(i + j * 4, false)
    }
    t = d;

    d = this.aes.decrypt(d);

    for (j = 0; j < 4; j++) {
      buffer.writeInt32BE(d[j] ^ iv[j], i + j * 4, false)
    }
    iv = t;
  }
}


// encrypt Buffer in CTR mode, return MAC
AES.prototype.encrypt_ctr_mac = function(b, nonce, pos)
{
  var ctr = [nonce[0],nonce[1],(pos/0x1000000000) >>> 0,(pos/0x10) >>> 0];
  var mac = [ctr[0],ctr[1],ctr[0],ctr[1]];

  var enc, i, j, len, v;

  var data0, data1, data2, data3;

  len = b.length-16;

  var v = new DataView(b);

  for (i = 0; i < len; i += 16)
  {
    data0 = v.getUint32(i,false);
    data1 = v.getUint32(i+4,false);
    data2 = v.getUint32(i+8,false);
    data3 = v.getUint32(i+12,false);

    // compute MAC
    mac[0] ^= data0;
    mac[1] ^= data1;
    mac[2] ^= data2;
    mac[3] ^= data3;
    mac = this.aes.encrypt(mac);

    // encrypt using CTR
    enc = this.aes.encrypt(ctr);
    v.setUint32(i,data0 ^ enc[0],false);
    v.setUint32(i+4,data1 ^ enc[1],false);
    v.setUint32(i+8,data2 ^ enc[2],false);
    v.setUint32(i+12,data3 ^ enc[3],false);

    if (!(++ctr[3])) ctr[2]++;
  }

  if (i < b.length)
  {
    var fullbuf = new Uint8Array(b);
    var tmpbuf = new ArrayBuffer(16);
    var tmparray = new Uint8Array(tmpbuf);

    tmparray.set(fullbuf.subarray(i));

    v = new DataView(tmpbuf);

    enc = this.aes.encrypt(ctr);

    data0 = v.getUint32(0,false);
    data1 = v.getUint32(4,false);
    data2 = v.getUint32(8,false);
    data3 = v.getUint32(12,false);

    mac[0] ^= data0;
    mac[1] ^= data1;
    mac[2] ^= data2;
    mac[3] ^= data3;
    mac = this.aes.encrypt(mac);

    enc = this.aes.encrypt(ctr);
    v.setUint32(0,data0 ^ enc[0],false);
    v.setUint32(4,data1 ^ enc[1],false);
    v.setUint32(8,data2 ^ enc[2],false);
    v.setUint32(12,data3 ^ enc[3],false);

    fullbuf.set(tmparray.subarray(0,j = fullbuf.length-i),i);
  }

  return mac;
}

// decrypt Buffer in CTR mode, return MAC
AES.prototype.decrypt_ctr_mac = function(b, nonce, pos) {
  var ctr = [nonce[0],nonce[1],(pos/0x1000000000) >>> 0,(pos/0x10) >>> 0];
  var mac = [ctr[0],ctr[1],ctr[0],ctr[1]];
  var enc, len, i, j, v;

  var data0, data1, data2, data3;

  len = b.length-16;  // @@@ -15?
  var v = new DataView(b);

  for (i = 0; i < len; i += 16) {
    enc = this.aes.encrypt(ctr);

    data0 = v.getUint32(i,false)^enc[0];
    data1 = v.getUint32(i+4,false)^enc[1];
    data2 = v.getUint32(i+8,false)^enc[2];
    data3 = v.getUint32(i+12,false)^enc[3];

    v.setUint32(i,data0,false);
    v.setUint32(i+4,data1,false);
    v.setUint32(i+8,data2,false);
    v.setUint32(i+12,data3,false);

    mac[0] ^= data0;
    mac[1] ^= data1;
    mac[2] ^= data2;
    mac[3] ^= data3;


    mac = this.aes.encrypt(mac);

    if (!(++ctr[3])) ctr[2]++;
  }

  if (i < b.length) {
    var fullbuf = new Uint8Array(b);
    var tmpbuf = new ArrayBuffer(16);
    var tmparray = new Uint8Array(tmpbuf);

    tmparray.set(fullbuf.subarray(i));

    v = new DataView(tmpbuf);

    enc = this.aes.encrypt(ctr);
    data0 = v.getUint32(0,false)^enc[0];
    data1 = v.getUint32(4,false)^enc[1];
    data2 = v.getUint32(8,false)^enc[2];
    data3 = v.getUint32(12,false)^enc[3];

    v.setUint32(0,data0,false);
    v.setUint32(4,data1,false);
    v.setUint32(8,data2,false);
    v.setUint32(12,data3,false);

    fullbuf.set(tmparray.subarray(0,j = fullbuf.length-i),i);

    while (j < 16) tmparray[j++] = 0;

    mac[0] ^= v.getUint32(0,false);
    mac[1] ^= v.getUint32(4,false);
    mac[2] ^= v.getUint32(8,false);
    mac[3] ^= v.getUint32(12,false);
    mac = this.aes.encrypt(mac);
  }

  return mac;
}

AES.prototype.condenseMacs = function(macs) {
  // todo: I think this object format is not needed any more
  var t = [];
  for (p in macs) t.push(p);

  t.sort(function(a,b) { return parseInt(a)-parseInt(b) });

  for (i = 0; i < t.length; i++) t[i] = macs[t[i]];

  var j;
  var mac = [0,0,0,0];

  for (i = 0; i < t.length; i++)
  {
    for (j = 0; j < 4; j++) mac[j] ^= t[i][j];
    mac = this.aes.encrypt(mac);
  }

  return mac;
}


exports.AES = AES