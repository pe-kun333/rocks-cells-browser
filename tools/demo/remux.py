# 断片化された MP4（MediaRecorder の出力。映像1本）を、ふつうの MP4（moov が先頭・長さと目次つき）に組み直す
# 使い方: python remux.py in.mp4 out.mp4
import struct
import sys

src, dst = sys.argv[1], sys.argv[2]
data = open(src, 'rb').read()


def boxes(start, end):
    pos = start
    while pos + 8 <= end:
        size, kind = struct.unpack('>I4s', data[pos:pos + 8])
        header = 8
        if size == 1:
            size = struct.unpack('>Q', data[pos + 8:pos + 16])[0]
            header = 16
        elif size == 0:
            size = end - pos
        yield kind, pos, pos + header, pos + size
        pos += size


def child(start, end, kind):
    for k, p, b, e in boxes(start, end):
        if k == kind:
            return p, b, e
    return None


def box(kind, payload):
    return struct.pack('>I4s', 8 + len(payload), kind) + payload


def full(kind, version, flags, payload):
    return box(kind, struct.pack('>I', (version << 24) | flags) + payload)


# ---------- 元の moov ----------
moov = child(0, len(data), b'moov')
trak = child(moov[1], moov[2], b'trak')
mdia = child(trak[1], trak[2], b'mdia')
minf = child(mdia[1], mdia[2], b'minf')
stbl = child(minf[1], minf[2], b'stbl')
mvhd = child(moov[1], moov[2], b'mvhd')
tkhd = child(trak[1], trak[2], b'tkhd')
mdhd = child(mdia[1], mdia[2], b'mdhd')
raw = lambda b: data[b[0]:b[2]]
hdlr = raw(child(mdia[1], mdia[2], b'hdlr'))
vmhd = raw(child(minf[1], minf[2], b'vmhd'))
dinf = raw(child(minf[1], minf[2], b'dinf'))
stsd = raw(child(stbl[1], stbl[2], b'stsd'))
mvex = child(moov[1], moov[2], b'mvex')
trex = child(mvex[1], mvex[2], b'trex')
_, _, _, d_desc, d_dur, d_size, d_flags = struct.unpack('>IIIIIII', data[trex[1]:trex[1] + 28])

ver = lambda b: data[b[1]]
mvhd_ts = struct.unpack('>I', data[mvhd[1] + (20 if ver(mvhd) == 1 else 12):][:4])[0]
mdhd_ts = struct.unpack('>I', data[mdhd[1] + (20 if ver(mdhd) == 1 else 12):][:4])[0]

# ---------- 断片から、コマ（sample）を集める ----------
samples = []  # (offset, size, duration, sync, cts)
for kind, p, b, e in boxes(0, len(data)):
    if kind != b'moof':
        continue
    moof_start = p
    for tk, tp, tb, te in boxes(b, e):
        if tk != b'traf':
            continue
        tfhd = child(tb, te, b'tfhd')
        fl = struct.unpack('>I', data[tfhd[1]:tfhd[1] + 4])[0] & 0xFFFFFF
        q = tfhd[1] + 8  # flags + track_ID
        base = moof_start
        dur, size, sflags = d_dur, d_size, d_flags
        if fl & 0x01:
            base = struct.unpack('>Q', data[q:q + 8])[0]
            q += 8
        if fl & 0x02:
            q += 4
        if fl & 0x08:
            dur = struct.unpack('>I', data[q:q + 4])[0]
            q += 4
        if fl & 0x10:
            size = struct.unpack('>I', data[q:q + 4])[0]
            q += 4
        if fl & 0x20:
            sflags = struct.unpack('>I', data[q:q + 4])[0]
            q += 4
        for rk, rp, rb, re_ in boxes(tb, te):
            if rk != b'trun':
                continue
            vf = struct.unpack('>I', data[rb:rb + 4])[0]
            tver, tfl = vf >> 24, vf & 0xFFFFFF
            count = struct.unpack('>I', data[rb + 4:rb + 8])[0]
            q = rb + 8
            offset = base
            if tfl & 0x01:
                offset = base + struct.unpack('>i', data[q:q + 4])[0]
                q += 4
            first_flags = None
            if tfl & 0x04:
                first_flags = struct.unpack('>I', data[q:q + 4])[0]
                q += 4
            for i in range(count):
                sd, ss, sf, sc = dur, size, sflags, 0
                if tfl & 0x100:
                    sd = struct.unpack('>I', data[q:q + 4])[0]
                    q += 4
                if tfl & 0x200:
                    ss = struct.unpack('>I', data[q:q + 4])[0]
                    q += 4
                if tfl & 0x400:
                    sf = struct.unpack('>I', data[q:q + 4])[0]
                    q += 4
                elif i == 0 and first_flags is not None:
                    sf = first_flags
                if tfl & 0x800:
                    sc = struct.unpack('>i' if tver else '>I', data[q:q + 4])[0]
                    q += 4
                samples.append((offset, ss, sd, not (sf & 0x10000), sc))
                offset += ss

total = sum(s[2] for s in samples)
movie_total = round(total * mvhd_ts / mdhd_ts)


def patch_duration(b, value, offset_v0, offset_v1):
    chunk = bytearray(raw(b))
    if data[b[1]] == 1:
        struct.pack_into('>Q', chunk, (b[1] - b[0]) + offset_v1, value)
    else:
        struct.pack_into('>I', chunk, (b[1] - b[0]) + offset_v0, value)
    return bytes(chunk)


# mvhd: [vf][ct][mt][ts][dur]  tkhd: [vf][ct][mt][id][res][dur]  mdhd: [vf][ct][mt][ts][dur]
mvhd_b = patch_duration(mvhd, movie_total, 16, 24)
tkhd_b = patch_duration(tkhd, movie_total, 20, 28)
mdhd_b = patch_duration(mdhd, total, 16, 24)


def run_length(values):
    out = []
    for v in values:
        if out and out[-1][1] == v:
            out[-1][0] += 1
        else:
            out.append([1, v])
    return out


stts_runs = run_length([s[2] for s in samples])
stts = full(b'stts', 0, 0, struct.pack('>I', len(stts_runs)) + b''.join(struct.pack('>II', n, v) for n, v in stts_runs))
syncs = [i + 1 for i, s in enumerate(samples) if s[3]]
stss = full(b'stss', 0, 0, struct.pack('>I', len(syncs)) + b''.join(struct.pack('>I', n) for n in syncs))
stsz = full(b'stsz', 0, 0, struct.pack('>II', 0, len(samples)) + b''.join(struct.pack('>I', s[1]) for s in samples))
stsc = full(b'stsc', 0, 0, struct.pack('>IIII', 1, 1, len(samples), 1))
ctts = b''
if any(s[4] for s in samples):
    runs = run_length([s[4] for s in samples])
    ctts = full(b'ctts', 1, 0, struct.pack('>I', len(runs)) + b''.join(struct.pack('>Ii', n, v) for n, v in runs))


def build(chunk_offset):
    stco = full(b'stco', 0, 0, struct.pack('>II', 1, chunk_offset))
    new_stbl = box(b'stbl', stsd + stts + ctts + stss + stsc + stsz + stco)
    new_minf = box(b'minf', vmhd + dinf + new_stbl)
    new_mdia = box(b'mdia', mdhd_b + hdlr + new_minf)
    new_trak = box(b'trak', tkhd_b + new_mdia)
    return box(b'moov', mvhd_b + new_trak)


ftyp = box(b'ftyp', b'isom' + struct.pack('>I', 512) + b'isomiso2avc1mp41')
moov_len = len(build(0))
mdat_payload_start = len(ftyp) + moov_len + 8
new_moov = build(mdat_payload_start)
assert len(new_moov) == moov_len
with open(dst, 'wb') as f:
    f.write(ftyp)
    f.write(new_moov)
    f.write(struct.pack('>I4s', 8 + sum(s[1] for s in samples), b'mdat'))
    for off, size, *_ in samples:
        f.write(data[off:off + size])
print(f'samples {len(samples)}  sync {len(syncs)}  duration {total / mdhd_ts:.2f}s  ctts {bool(ctts)}')
