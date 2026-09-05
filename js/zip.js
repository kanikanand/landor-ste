/* ============================================================================
 * zip.js — a minimal ZIP writer, so one download can hand over a folder.
 *
 * The export is two files that belong together: the drawing, and the settings
 * that produced it. A browser cannot write a folder, so it writes the archive
 * that unpacks into one. Entries are stored, not deflated — an SVG of dots
 * compresses well, but pulling in a deflate implementation to save a few
 * hundred kilobytes would cost more than it returns, and stored entries are
 * readable by every unarchiver there is.
 * ==========================================================================*/
var CD = window.CD || {};

(function (CD) {
  'use strict';

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  /* A growable little-endian byte sink. */
  function Sink() {
    this.parts = [];
    this.length = 0;
  }
  Sink.prototype.bytes = function (b) { this.parts.push(b); this.length += b.length; };
  Sink.prototype.u16 = function (v) { this.bytes(new Uint8Array([v & 255, (v >>> 8) & 255])); };
  Sink.prototype.u32 = function (v) {
    this.bytes(new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]));
  };
  Sink.prototype.join = function () {
    var out = new Uint8Array(this.length), at = 0;
    for (var i = 0; i < this.parts.length; i++) { out.set(this.parts[i], at); at += this.parts[i].length; }
    return out;
  };

  /* MS-DOS packed date and time, which is what a ZIP entry carries. */
  function dosTime(d) {
    return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
  }
  function dosDate(d) {
    return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  }

  /* files: [{ name, data }] where data is a string or a Uint8Array.
   * Returns a Blob ready to hand to a download link. */
  function makeZip(files) {
    var enc = new TextEncoder();
    var now = new Date();
    var time = dosTime(now), date = dosDate(now);

    var body = new Sink();
    var dir = new Sink();

    files.forEach(function (f) {
      var name = enc.encode(f.name);
      var data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      var crc = crc32(data);
      var offset = body.length;

      body.u32(0x04034b50);
      body.u16(20);            // version needed
      body.u16(0x0800);        // UTF-8 names
      body.u16(0);             // stored
      body.u16(time); body.u16(date);
      body.u32(crc);
      body.u32(data.length); body.u32(data.length);
      body.u16(name.length); body.u16(0);
      body.bytes(name);
      body.bytes(data);

      dir.u32(0x02014b50);
      dir.u16(20);             // version made by
      dir.u16(20);             // version needed
      dir.u16(0x0800);
      dir.u16(0);
      dir.u16(time); dir.u16(date);
      dir.u32(crc);
      dir.u32(data.length); dir.u32(data.length);
      dir.u16(name.length);
      dir.u16(0); dir.u16(0);  // extra, comment
      dir.u16(0);              // disk
      dir.u16(0); dir.u32(0);  // internal, external attributes
      dir.u32(offset);
      dir.bytes(name);
    });

    var end = new Sink();
    end.u32(0x06054b50);
    end.u16(0); end.u16(0);
    end.u16(files.length); end.u16(files.length);
    end.u32(dir.length);
    end.u32(body.length);
    end.u16(0);

    return new Blob([body.join(), dir.join(), end.join()], { type: 'application/zip' });
  }

  function downloadBlob(filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  CD.makeZip = makeZip;
  CD.downloadBlob = downloadBlob;
})(CD);
