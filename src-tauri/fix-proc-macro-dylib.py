#!/usr/bin/env python3
"""
Patch a Mach-O dylib to 8-byte-align the LC_SYMTAB string pool and
LC_CODE_SIGNATURE start. macOS 27 beta (Apple LD 1328.2) produces
4-byte-aligned string pools at opt-level > 0, but dyld requires 8-byte.
Run silently so it doesn't interfere with Cargo output.
"""
import struct, sys, subprocess

LC_SEGMENT_64     = 0x19
LC_SYMTAB         = 0x2
LC_CODE_SIGNATURE = 0x1d

def u32(d, o):  return struct.unpack_from('<I', d, o)[0]
def u64(d, o):  return struct.unpack_from('<Q', d, o)[0]
def w32(d, o, v): struct.pack_into('<I', d, o, v)
def w64(d, o, v): struct.pack_into('<Q', d, o, v)

def patch(path):
    try:
        data = bytearray(open(path, 'rb').read())
    except Exception:
        return

    if u32(data, 0) != 0xFEEDFACF:
        return  # not 64-bit LE Mach-O

    ncmds = u32(data, 16)
    off = 32
    lc_symtab = lc_linkedit = lc_codesig = None

    for _ in range(ncmds):
        cmd     = u32(data, off)
        cmdsize = u32(data, off + 4)
        if cmd == LC_SYMTAB:
            lc_symtab = off
        elif cmd == LC_SEGMENT_64:
            segname = data[off+8:off+24].rstrip(b'\x00').decode('ascii', errors='replace')
            if segname == '__LINKEDIT':
                lc_linkedit = off
        elif cmd == LC_CODE_SIGNATURE:
            lc_codesig = off
        off += cmdsize

    if lc_symtab is None:
        return

    stroff  = u32(data, lc_symtab + 16)
    strsize = u32(data, lc_symtab + 20)

    total_pad = 0

    # Fix 1: align string pool to 8 bytes
    str_pad = (8 - stroff % 8) % 8
    if str_pad:
        data = data[:stroff] + bytes(str_pad) + data[stroff:]
        w32(data, lc_symtab + 16, stroff + str_pad)
        total_pad += str_pad

    new_stroff = stroff + str_pad
    strpool_end = new_stroff + strsize

    # Fix 2: align code signature to 8 bytes
    if lc_codesig is not None:
        csig_off = u32(data, lc_codesig + 8) + str_pad
        csig_pad = (8 - csig_off % 8) % 8
        if csig_pad:
            data = data[:strpool_end] + bytes(csig_pad) + data[strpool_end:]
            w32(data, lc_codesig + 8, csig_off + csig_pad)
            total_pad += csig_pad

    if total_pad == 0:
        return  # already aligned

    # Update __LINKEDIT filesize and vmsize
    if lc_linkedit is not None:
        w64(data, lc_linkedit + 32, u64(data, lc_linkedit + 32) + total_pad)
        w64(data, lc_linkedit + 48, u64(data, lc_linkedit + 48) + total_pad)

    open(path, 'wb').write(data)

    # Re-sign ad-hoc (required after binary modification)
    subprocess.run(
        ['codesign', '--sign', '-', '--force', path],
        capture_output=True
    )

if __name__ == '__main__':
    if len(sys.argv) >= 2:
        patch(sys.argv[1])
