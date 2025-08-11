
(function(){
  const dot = document.createElement('div');
  const ring = document.createElement('div');
  dot.className = 'cursor-dot';
  ring.className = 'cursor-ring';
  Object.assign(dot.style, {width:'6px',height:'6px',borderRadius:'9999px',background:'white'});
  Object.assign(ring.style, {width:'28px',height:'28px',border:'1px solid rgba(255,255,255,0.5)',borderRadius:'9999px'});
  document.body.appendChild(ring);
  document.body.appendChild(dot);

  let x=window.innerWidth/2, y=window.innerHeight/2;
  let rx=x, ry=y;
  const lerp = (a,b,t)=>a+(b-a)*t;

  window.addEventListener('mousemove',(e)=>{ x=e.clientX; y=e.clientY; });
  function tick(){
    rx = lerp(rx, x, 0.18);
    ry = lerp(ry, y, 0.18);
    ring.style.transform = `translate(${rx-14}px, ${ry-14}px)`;
    dot.style.transform = `translate(${x-3}px, ${y-3}px)`;
    requestAnimationFrame(tick);
  }
  tick();
})();
