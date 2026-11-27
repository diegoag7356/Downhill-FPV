# Plan de construcción: Downhill FPV por semillas

Para un agente de IA de programación (freebuff). Léelo entero antes de escribir código y trabaja fase por fase.

## 1. Qué se construye

Un juego 3D de navegador en primera persona (FPV): bajas en bici por pistas de downhill de tierra, con curvas cerradas, horquillas y saltos. Cada pista sale de una **semilla** (como en Minecraft): la misma semilla da siempre la misma pista. Hay una **pila de semillas** ordenada de fácil a difícil.

## 2. Reglas de oro

1. **Greybox primero.** Hasta la fase 8 todo es geometría gris: triángulos con un solo material gris y `flatShading`. Sin colores, sin texturas, sin árboles, sin niebla decorativa, sin sonido, sin low poly bonito. El diseño es cosa del final.
2. **La cámara GIRA, no se inclina.** El jugador cambia su rumbo (yaw). La cámara nunca hace roll: `camera.rotation.z` es siempre 0. Girar a la izquierda o a la derecha rota la vista y la dirección de avance, no desplaza al jugador de lado ni inclina la imagen.
3. **Todo se calcula en el espacio del mundo (x, y, z).** Prohibido modelar al jugador como "distancia a lo largo de la pista + desvío lateral". La pista es solo un terreno por el que se mueve un cuerpo libre.
4. **Determinismo.** La generación solo usa el PRNG con semilla. Nunca `Math.random()` ni `Date.now()` al generar.
5. **Rendimiento mínimo exigido:** 60 fps en un PC con 8 GB de RAM y gráfica integrada o normal; menos de 100 draw calls; sin librerías pesadas; sin sombras dinámicas.
6. **Una fase cada vez.** No empieces la siguiente hasta cumplir los criterios de aceptación de la actual. Un commit por fase como mínimo.

Nota: existe un prototipo previo en HTML que mueve al jugador por "posición en la pista + desvío lateral" y lo inclina al girar. Es solo una referencia de la idea del generador. **No reutilices su modelo de control.**

## 3. Stack y estructura

- HTML + JavaScript con módulos ES y Three.js con versión fija (por ejemplo r160). Vite opcional. Sin frameworks de UI.
- Un archivo por responsabilidad:

```
/src
  main.js          bucle, renderer, escenas
  input.js         teclado y táctil
  player.js        física y estado del jugador
  camera.js        cámara FPV
  rng.js           hash de semilla + PRNG (mulberry32)
  trackgen.js      semilla -> pista (centerline, alturas)
  trackmesh.js     pista -> malla gris
  terrain.js       consulta de altura y normal del suelo
  difficulty.js    métricas y tiers
  seeds.js / seeds.json   pila de semillas
  debug.js         overlay y cámara libre
/tests             tests de determinismo y validez
```

## 4. Modelo de control (lo más importante)

**Estado:** posición `p` (x, y, z), rumbo `yaw` (ψ), velocidad horizontal `vel` (vector x, z), velocidad vertical `vy`, estado `grounded`.

**Giro:**

- `A`/`D` (o ←/→) cambian el **rumbo**: `yaw += steer * turnRate(speed) * dt`.
- `turnRate` baja con la velocidad: unos 2,2 rad/s parado o lento y unos 0,9 rad/s a máxima velocidad.
- La cámara usa `yaw` directamente. `camera.rotation.order = 'YXZ'`, `rotation.z = 0`.

**Agarre e inercia (esto hace que las curvas cerradas exijan frenar):**

- La velocidad no se pone al instante en la dirección del rumbo: `vel` gira hacia `yaw` con una tasa de agarre `grip(speed)`.
- El ángulo entre `vel` y `yaw` es el **derrape**. Si el derrape crece, pierdes velocidad (`speed -= k * sin(derrape) * speed * dt`) y la trayectoria se abre hacia fuera.
- Si el derrape pasa de un máximo (por ejemplo 45°), pierdes el control un instante: giro muy reducido y mucha pérdida de velocidad.

**Pedalear y frenar:** `W` suma aceleración, `S` frena fuerte. La gravedad sobre la pendiente del suelo acelera la bajada. Rozamiento con el aire cuadrático.

**Cámara:**

- Altura de ojos constante sobre el suelo, con un pequeño rebote al aterrizar.
- `pitch` sigue la pendiente del terreno, y en el aire sigue la trayectoria (`atan2(vy, speed)`), suavizado.
- Sin roll, sin lean. Un FOV algo mayor a más velocidad es lo único permitido.

## 5. Terreno y colisión

- La pista es una **cinta** definida por una línea central (centerline) con ancho fijo, más arcenes que bajan a los lados.
- `terrain.heightAt(x, z)` y `terrain.normalAt(x, z)`: busca el segmento más cercano de la pista con una cuadrícula espacial (spatial hash) e interpola. Fuera de la pista y los arcenes el suelo cae en pared: caer ahí es salirse.
- Sin librerías de física. Un bucle propio con paso de tiempo fijo (1/120 s) y render interpolado.
- Saltos: el jugador pasa a aire cuando el suelo cae por debajo de su trayectoria balística. Aterriza al tocar el suelo. Un impacto fuerte resta velocidad.
- Salirse de la pista: respawn en el último punto seguro mirando a la pista, con 3 s de penalización.

## 6. Generación por semillas

**Pipeline:** `seed` → parámetros globales → secuencia de segmentos → centerline → alturas → malla.

1. `hashSeed(string)` → entero de 32 bits → `mulberry32`.
2. Parámetros globales desde la semilla: agresividad `w` (0 a 1), longitud (1 a 2 km), pendiente media.
3. Segmentos con piezas: recta, curva abierta, curva cerrada, horquilla (180°), S doble, salto (mesa o doble), drop (caída), tramo de baches. Cuanto mayor `w`, más curvas cerradas y más saltos.
4. Altura: pendiente base descendente más ondulación suave, más los perfiles de salto.
5. **Garantías de validez** (toda semilla debe ser jugable):
   - radio mínimo de curva y pendiente máxima definidos;
   - cada salto con tramo de aceleración previo y zona de aterrizaje de al menos 15 m en pendiente;
   - la pista no se cruza ni se solapa a sí misma (comprobación con la cuadrícula). Si un segmento choca, se regenera con una sub-semilla derivada, de forma determinista.
6. **Versión del generador:** el id público es `v1:semilla`. Si cambias el algoritmo, sube la versión para no romper semillas antiguas.

**Tests obligatorios:**

- La misma semilla genera el mismo hash de pista dos veces.
- 1000 semillas se generan sin errores, sin auto-cruces y cumpliendo las garantías.

## 7. Dificultad y pila de semillas

- `difficulty.js` calcula sobre la pista ya generada: giro total, número y cierre de las curvas más cerradas, número y longitud de saltos, pendiente media y máxima. Combina en una puntuación.
- **Tiers 1 a 5** (Fácil, Media, Difícil, Muy difícil, Extrema), por percentiles sobre un lote grande de semillas. Cuando estén calibrados, se fijan los umbrales.
- **Pila inicial elegida por nosotros:** un script escanea N semillas, las ordena por puntuación y propone candidatas por tier; las pruebo a mano y confirmo cuáles entran en `seeds.json`.
- La pantalla de selección muestra la lista ordenada de fácil a difícil y permite escribir una semilla propia. Debe mostrar su dificultad antes de jugar. Semilla por URL: `?seed=v1:1234`.
- Más adelante (fase 9): popularidad y votos con un backend. Al principio, mejores tiempos en `localStorage`.

## 8. Fases y criterios de aceptación

**Fase 0 · Andamiaje.** Proyecto, bucle de juego, cámara FPV sobre un plano gris enorme, HUD de depuración (fps, draw calls, triángulos, velocidad, yaw, semilla). *Aceptación:* 60 fps, el ratón/teclado no rompen nada, el HUD funciona.

**Fase 1 · Control y giro en plano.** Movimiento con yaw, aceleración, freno, agarre y derrape. Sin pista aún. *Aceptación:* al mantener `D` la vista rota de forma continua y avanzas en círculo; `camera.rotation.z === 0` siempre (test automático); a más velocidad el círculo es más abierto y aparece derrape.

**Fase 2 · Pista greybox fija.** Una pista escrita a mano: pendiente continua, una curva cerrada, una horquilla, un salto. Malla gris con `flatShading`. Altura del suelo por consulta. Respawn al salirse. *Aceptación:* se puede completar a mano; la curva cerrada a toda velocidad te saca de la pista; el salto da tiempo en el aire.

**Fase 3 · Saltos y aterrizaje.** Física del aire, aterrizaje, pérdida de velocidad por impacto fuerte. *Aceptación:* aterrizajes consistentes a distintas velocidades, sin atravesar el suelo (test con 100 saltos simulados).

**Fase 4 · Generador por semilla.** `rng.js`, `trackgen.js`, `trackmesh.js`, validación y tests de la sección 6. *Aceptación:* los tests pasan; en el modo debug se ve la centerline y todas las semillas probadas son jugables.

**Fase 5 · Dificultad y pila.** `difficulty.js`, tiers, script de escaneo, `seeds.json`, selector en HTML plano gris. *Aceptación:* la lista va de fácil a difícil y las semillas fáciles se sienten fáciles al jugarlas.

**Fase 6 · Bucle de juego completo.** Salida, cronómetro, meta, checkpoints, reinicio (`R`), menú (`Esc`), mejor tiempo por semilla. *Aceptación:* se puede jugar una pista de principio a fin y repetirla.

**Fase 7 · Rendimiento.** Perfilado en equipo modesto, límite de resolución, carga por trozos (chunks) si hay pistas largas, sin picos de memoria al cambiar de semilla (liberar geometrías). *Aceptación:* 60 fps sostenidos, menos de 100 draw calls, menos de 300 MB de memoria.

**Fase 8 · Diseño visual (solo ahora).** Paletas por semilla o bioma, low poly, árboles instanciados, polvo, niebla, sonido. *Aceptación:* el rendimiento de la fase 7 se mantiene.

**Fase 9 · Online (opcional).** Pila global con votos y popularidad, tiempos compartidos, ghost de la mejor vuelta.

## 9. Herramientas de depuración (desde la fase 0)

- Overlay con fps, draw calls, triángulos, velocidad, yaw, derrape, semilla.
- Tecla de debug: wireframe, línea central, normales, cámara libre.
- Semilla por URL y botón de semilla aleatoria.

## 10. Valores iniciales sugeridos

| Parámetro | Valor inicial |
| --- | --- |
| Ancho de pista | 6 m |
| Radio mínimo de curva | 12 m |
| Pendiente media | 6 a 14 % |
| Velocidad típica | 12 a 22 m/s |
| Giro máximo (lento / rápido) | 2,2 / 0,9 rad/s |
| Derrape máximo antes de perder control | 45° |
| Gravedad | 9,8 m/s² |
| Altura de ojos | 1,6 m |

## 11. Cómo debe trabajar el agente

- Haz commits pequeños con un mensaje claro por cada paso.
- Ejecuta los tests antes de dar una fase por terminada y di qué criterios de aceptación se cumplen.
- Si algo es ambiguo, pregunta antes de inventar.
- No añadas nada visual ni de contenido que no esté en la fase actual.
- Si ves que una regla de oro choca con un criterio, párate y avísame.

## 12. Prompt inicial para pegar al agente

> Lee el documento "Plan de construcción: Downhill FPV por semillas" entero. Empieza solo por la Fase 0 y dime cuándo cumple sus criterios de aceptación antes de seguir. Todo en greybox gris, sin diseño visual. La cámara gira (yaw) y nunca se inclina (roll). El jugador se mueve en espacio de mundo, no como "distancia más desvío lateral".
