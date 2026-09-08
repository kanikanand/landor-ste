/* ============================================================================
 * zip.js — a very small ZIP writer, so Download can hand over a folder.
 *
 * Browsers cannot write a directory, so a folder means a .zip. Everything here
 * is stored uncompressed: an SVG of a few hundred kilobytes and a page of text
 * are not worth pulling in a deflate implementation for, and a stored entry is
 * about forty lines of header writing that any tool on any platform opens.
 * ==========================================================================*/
var CD = window.CD || {};

(function (CD) {
  'use strict';

  /* Standard CRC-32, table built once on first use. */
  var TABLE = null;
  function crcTable() {
    if (TABLE) return TABLE;
    TABLE = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      TABLE[i] = c >>> 0;
    }
    return TABLE;
  }

  function crc32(bytes) {
    var t = crcTable(), c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(str) {
    return new TextEncoder().encode(str);
  }

  /* MS-DOS packed date and time, which is what a ZIP header wants. */
  function dosStamp(d) {
    var time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time: time & 0xFFFF, date: date & 0xFFFF };
  }

  function writer(size) {
    var buf = new Uint8Array(size), at = 0;
    return {
      buf: buf,
      get pos() { return at; },
      u16: function (v) { buf[at++] = v & 255; buf[at++] = (v >>> 8) & 255; },
      u32: function (v) {
        buf[at++] = v & 255; buf[at++] = (v >>> 8) & 255;
        buf[at++] = (v >>> 16) & 255; buf[at++] = (v >>> 24) & 255;
      },
      bytes: function (b) { buf.set(b, at); at += b.length; }
    };
  }

  /* files: [{ name, text }] -> Blob. Names may contain '/', which is how a
   * zip carries a folder: one prefix on every entry. */
  function zip(files) {
    var stamp = dosStamp(new Date());
    var entries = files.map(function (f) {
      var name = utf8(f.name);
      var data = utf8(f.text);
      return { name: name, data: data, crc: crc32(data), offset: 0 };
    });

    var localSize = entries.reduce(function (a, e) {
      return a + 30 + e.name.length + e.data.length;
    }, 0);
    var centralSize = entries.reduce(function (a, e) {
      return a + 46 + e.name.length;
    }, 0);

    var w = writer(localSize + centralSize + 22);

    entries.forEach(function (e) {
      e.offset = w.pos;
      w.u32(0x04034b50);          // local file header
      w.u16(20);                  // version needed
      w.u16(0x0800);              // UTF-8 names
      w.u16(0);                   // stored, no compression
      w.u16(stamp.time); w.u16(stamp.date);
      w.u32(e.crc);
      w.u32(e.data.length);       // compressed size == uncompressed
      w.u32(e.data.length);
      w.u16(e.name.length);
      w.u16(0);                   // no extra field
      w.bytes(e.name);
      w.bytes(e.data);
    });

    var centralAt = w.pos;
    entries.forEach(function (e) {
      w.u32(0x02014b50);          // central directory header
      w.u16(20); w.u16(20);
      w.u16(0x0800);
      w.u16(0);
      w.u16(stamp.time); w.u16(stamp.date);
      w.u32(e.crc);
      w.u32(e.data.length); w.u32(e.data.length);
      w.u16(e.name.length);
      w.u16(0); w.u16(0);         // extra, comment
      w.u16(0);                   // disk number
      w.u16(0); w.u32(0);         // internal / external attributes
      w.u32(e.offset);
      w.bytes(e.name);
    });

    /* Measure the directory before writing the end record, not during it:
     * w.pos has already moved on by then. */
    var centralBytes = w.pos - centralAt;

    w.u32(0x06054b50);            // end of central directory
    w.u16(0); w.u16(0);
    w.u16(entries.length); w.u16(entries.length);
    w.u32(centralBytes);
    w.u32(centralAt);
    w.u16(0);

    return new Blob([w.buf], { type: 'application/zip' });
  }

  CD.zip = zip;
  CD.crc32 = crc32;
})(CD);
