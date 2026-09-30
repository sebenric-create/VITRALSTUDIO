# Vitral Studio Web — v0.4 alpha

Editor web híbrido vector + raster para ilustración y coloreo tipo vitral. Preparado para GitHub + Vercel.

## Novedades v0.4

- Relleno **Sólido**, **Degradado** y **Vidrio**.
- Segundo color configurable para degradados y vidrio.
- Ángulo de degradado de 0° a 360°.
- Intensidad de textura de vidrio regulable.
- El modo Vidrio agrega variación luminosa, grano sutil y una franja de brillo dentro de cada región.
- Los rellenos nuevos guardan su estilo dentro del archivo `.vitral`.
- Un relleno ya creado puede seleccionarse y **reestilizarse después** sin volver a detectar la región.
- Compatibilidad al abrir proyectos v0.2/v0.3.
- Se conserva v0.3: cuentagotas, paletas y Alpha Lock.
- Se conserva v0.2: capas, Bézier, lazo, formas, mouse/stylus/dedo, pinch zoom, autosave, `.vitral` y PNG.

## Flujo vitral recomendado

1. Contorno en capa **Lineart**.
2. Selecciona **Relleno**.
3. Elige **Sólido**, **Degradado** o **Vidrio**.
4. Toca una zona cerrada.
5. Si luego quieres otro acabado, usa **Seleccionar**, toca esa región y pulsa **Aplicar a región**.
6. Para sombras manuales, activa **Alpha Lock** en la capa Color.

## Ejecutar

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Vercel

- Framework preset: **Vite**
- Build command: `npm run build`
- Output directory: `dist`

## Próximos candidatos para v0.5

- Pinceles configurables y estabilización avanzada.
- Más texturas de vidrio/papel.
- Máscaras de clipping dedicadas.
- Historial visual de paletas.
- Exportación SVG de capas vectoriales.
