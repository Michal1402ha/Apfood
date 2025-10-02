// app/screens/OrbitHomeScreen.tsx — SAFE MODE (bez Reanimated/Gesture Handler)
// Ověřená stabilní verze: pouze Pressable na JS vlákně, žádné worklety.

import React, { useCallback, useMemo, useState } from 'react';
import { View, Image, Text, StyleSheet, LayoutChangeEvent, Dimensions, Pressable } from 'react-native';
import hotspotsJsonRaw from '../config/orbit.hotspots.json';

const BG = require('../../assets/bg/orbit-home.png');
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

type Rect = { x: number; y: number; w: number; h: number };
type CenterCfg = { cxPct?: number; cyPct?: number };
type HotspotRaw = {
  name?: unknown; imgXPct?: unknown; imgYPct?: unknown; radiusPct?: unknown;
  xPct?: unknown; yPct?: unknown; rPct?: unknown;
};
type Hotspot = { name: string; imgXPct: number; imgYPct: number; radiusPct: number; index: number };

function pct01FromPct100(v: unknown, fallback01 = 0) {
  if (typeof v === 'number' && isFinite(v)) return Math.max(0, Math.min(1, v / 100));
  return fallback01;
}
function computeContainRect(imgW: number, imgH: number, boxW: number, boxH: number): Rect {
  if (!imgW || !imgH || !boxW || !boxH) return { x: 0, y: 0, w: boxW, h: boxH };
  const s = Math.min(boxW / imgW, boxH / imgH);
  const w = imgW * s, h = imgH * s;
  const x = (boxW - w) / 2, y = (boxH - h) / 2;
  return { x, y, w, h };
}
function parseHotspots(raw: any): { center: CenterCfg; hotspots: Hotspot[] } {
  const center: CenterCfg = raw?.center && typeof raw.center === 'object' ? raw.center : {};
  const arr: any[] = Array.isArray(raw?.hotspots)
    ? raw.hotspots
    : (Array.isArray(raw) ? raw : []);
  const hs: Hotspot[] = arr.map((h: any, i: number) => ({
    name: (typeof h?.name === 'string' && h.name.trim()) ? h.name : `#${i}`,
    imgXPct: pct01FromPct100(typeof h?.imgXPct === 'number' ? h.imgXPct : (typeof h?.xPct === 'number' ? h.xPct : 0), 0),
    imgYPct: pct01FromPct100(typeof h?.imgYPct === 'number' ? h.imgYPct : (typeof h?.yPct === 'number' ? h.yPct : 0), 0),
    radiusPct: typeof h?.radiusPct === 'number' ? h.radiusPct : (typeof h?.rPct === 'number' ? h.rPct : 6),
    index: i,
  }));
  return { center, hotspots: hs };
}

export default function OrbitHomeScreen() {
  const [container, setContainer] = useState({ w: SCREEN_W, h: SCREEN_H });
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: SCREEN_W, h: SCREEN_H });
  const img = Image.resolveAssetSource(BG);
  const imgW = img?.width ?? 0;
  const imgH = img?.height ?? 0;

  const { center, hotspots } = useMemo(
    () => parseHotspots(hotspotsJsonRaw as any),
    []
  );

  const [activeIdx, setActiveIdx] = useState<number>(0);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainer({ w: width, h: height });
    const r = computeContainRect(imgW, imgH, width, height);
    setRect(r);
    // Debug center (px)
    const cx = r.x + r.w * pct01FromPct100(center.cxPct ?? 50);
    const cy = r.y + r.h * pct01FromPct100(center.cyPct ?? 50);
    console.log('[orbit:home:center:SAFE]', { cx: Math.round(cx), cy: Math.round(cy) });
  }, [imgW, imgH, center]);

  const hotspotPx = useCallback((h: Hotspot) => ({
    x: rect.x + rect.w * h.imgXPct,
    y: rect.y + rect.h * h.imgYPct,
  }), [rect]);

  const findNearest = useCallback((px: number, py: number) => {
    if (!hotspots.length) return null;
    let best: { h: Hotspot; d2: number } | null = null;
    for (const h of hotspots) {
      const { x, y } = hotspotPx(h);
      const dx = px - x;
      const dy = py - y;
      const d2 = dx*dx + dy*dy;
      if (!best || d2 < best.d2) best = { h, d2 };
    }
    return best?.h ?? null;
  }, [hotspots, hotspotPx]);

  const onPress = useCallback((evt: any) => {
    if (!hotspots.length) return;
    const px = evt.nativeEvent.locationX;
    const py = evt.nativeEvent.locationY;
    const h = findNearest(px, py);
    if (!h) return;
    setActiveIdx(h.index);
    console.log('[orbit:home:snap:SAFE]', { index: h.index, name: h.name });
  }, [findNearest, hotspots.length]);

  const activeName = useMemo(() => {
    const h = hotspots.find(x => x.index === activeIdx);
    return h?.name ?? '';
  }, [activeIdx, hotspots]);

  return (
    <View style={styles.root}>
      <View style={styles.container} onLayout={onLayout}>
        <Image source={BG} style={styles.bg} resizeMode="contain" />
        {/* Celoplošný hitbox na JS threadu */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onPress} />
        {/* Label */}
        <View style={styles.topLabelWrap} pointerEvents="none">
          <Text style={styles.topLabel} numberOfLines={1} ellipsizeMode="tail">
            {activeName}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'black' },
  container: { flex: 1 },
  bg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  topLabelWrap: { position: 'absolute', top: 28, left: 24, right: 24, alignItems: 'center', justifyContent: 'center' },
  topLabel: {
    color: 'white', fontSize: 22, fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.7)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6, letterSpacing: 0.5,
  },
});








