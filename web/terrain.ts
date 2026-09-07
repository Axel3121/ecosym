// Fixed procedural scenery. Neither terrain nor place materials accept institutional data.
export function drawTerrain(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  const w = canvas.width;
  const h = canvas.height;
  const noise = (x: number, y: number) => {
    let n = Math.imul(x + 71, 374761393) ^ Math.imul(y + 93, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return (n >>> 0) / 4294967296;
  };
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const river = 60 + Math.sin(y / 95) * 28 + Math.sin(y / 36) * 5;
      const shore = x - river;
      const stone = x - (435 + Math.sin(y / 74) * 28);
      const n = noise(x, y);
      let palette = ["#7e9568", "#84996c", "#899e71", "#7b9265"];
      if (shore < 0) palette = ["#507f83", "#55878a", "#5b8b8d", "#558487"];
      else if (shore < 9 + n * 9) palette = ["#afb18a", "#babc95", "#9ba881", "#b4b68e"];
      else if (stone > n * 22) palette = ["#939888", "#9ca08f", "#a4a595", "#8b9483"];
      context.fillStyle = palette[Math.floor(n * 4)]!;
      context.fillRect(x, y, 2, 2);
      if (shore < -8 && n > .982) {
        context.fillStyle = "#78a1a1";
        context.fillRect(x, y, 6, 1);
      } else if (shore > 25 && stone < 0 && n > .95) {
        context.fillStyle = "#637f56";
        context.fillRect(x, y - 1, 1, 3);
        context.fillStyle = "#a2b483";
        context.fillRect(x + 1, y - 2, 1, 2);
      }
    }
  }
  // Low rock shelves on the far bank establish the oblique camera without buildings.
  for (let y = 34; y < h; y += 137) {
    const x = 476 + Math.floor(noise(2, y) * 28);
    context.fillStyle = "#727d72";
    context.fillRect(x, y + 9, 23, 10);
    context.fillRect(x - 4, y + 6, 31, 7);
    context.fillStyle = "#b4b4a0";
    context.fillRect(x, y, 21, 11);
    context.fillRect(x - 4, y + 4, 30, 5);
    context.fillStyle = "#c5c3ad";
    context.fillRect(x + 1, y, 17, 2);
    context.fillStyle = "#89917e";
    context.fillRect(x + 13, y + 7, 8, 2);
  }
}

export function drawPlace(canvas: HTMLCanvasElement): void {
  const c = canvas.getContext("2d");
  if (!c) throw new Error("Canvas unavailable");
  // The same empty, low-walled stone enclosure for every declaration.
  c.fillStyle = "#52664b";
  c.fillRect(9, 29, 47, 9);
  c.fillStyle = "#777c6c";
  c.fillRect(5, 15, 46, 17);
  c.fillStyle = "#d0c6a8";
  c.fillRect(5, 10, 46, 18);
  c.fillStyle = "#a79e86";
  c.fillRect(10, 14, 36, 11);
  c.fillStyle = "#e2d8b9";
  c.fillRect(5, 9, 46, 3);
  c.fillRect(5, 12, 4, 15);
  c.fillStyle = "#898570";
  c.fillRect(46, 12, 5, 15);
  c.fillStyle = "#c0b79d";
  c.fillRect(5, 25, 17, 4);
  c.fillRect(34, 25, 17, 4);
  c.fillStyle = "#bdb69c";
  c.fillRect(22, 27, 12, 7);
  c.fillStyle = "#777c6c";
  c.fillRect(22, 30, 12, 1);
  for (let x = 12; x < 46; x += 8) {
    c.fillStyle = "#aaa38c";
    c.fillRect(x, 10, 1, 2);
    c.fillRect(x + 2, 26, 1, 3);
  }
  c.fillStyle = "#b7ae94";
  c.fillRect(14, 17, 11, 1);
  c.fillRect(30, 21, 12, 1);
}
