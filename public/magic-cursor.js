
(function(){
  // Only activate on the home page
  const currentPath = window.location.pathname;
  if (currentPath !== '/' && currentPath !== '/index.html') {
    return; // Exit early if not on home page
  }

  // Remove any existing cursor elements
  const existingCursor = document.querySelector('.cursor-dot, .cursor-ring');
  if (existingCursor) {
    existingCursor.remove();
  }

  // Particle system configuration - enhanced with magical effects
  const config = {
    maxParticles: 200, // Hard limit on total particles
    particleSize: { min: 1, max: 3 }, // Much smaller particles for delicate magic
    particleLife: 10000, // 10 second life in milliseconds
    particleSpeed: { min: 0.08, max: 0.25 }, // Even slower for smoother motion
    turbulence: 0.005, // Ultra-low turbulence for zero jitter
    flowForce: 0.997, // Slightly higher for smoother deceleration
    gravity: 0.002, // Gentler gravity for slower falling
    momentumInfluence: 0.4, // Reduced momentum for more controlled movement
    twinkleSpeed: 0.02, // Speed of twinkling effect
    iridescentColors: [
      '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57',
      '#ff9ff3', '#54a0ff', '#5f27cd', '#00d2d3', '#ff9f43'
    ]
  };

  // Particle class
  class Particle {
    constructor(x, y, vx, vy, momentumX = 0, momentumY = 0) {
      this.x = Math.round(x);
      this.y = Math.round(y);
      this.vx = vx;
      this.vy = vy;
      this.initialVx = vx; // Store initial velocity for deceleration
      this.initialVy = vy;
      this.life = config.particleLife; // 10 second life in milliseconds
      this.maxLife = config.particleLife;
      this.size = Math.random() * (config.particleSize.max - config.particleSize.min) + config.particleSize.min;
      this.initialSize = this.size; // Store initial size for scaling
      this.color = config.iridescentColors[Math.floor(Math.random() * config.iridescentColors.length)];
      this.opacity = 1;
      this.element = null;
      this.twinklePhase = Math.random() * Math.PI * 2; // Random twinkle phase
      this.birthTime = Date.now(); // Track when particle was created
      this.createElement();
    }

    createElement() {
      this.element = document.createElement('div');
      this.element.className = 'magical-particle';
      this.element.style.cssText = `
        position: fixed;
        width: ${this.size}px;
        height: ${this.size}px;
        background: ${this.color};
        border-radius: 50%;
        pointer-events: none;
        z-index: 9999;
        box-shadow: 0 0 ${this.size * 3}px ${this.color};
        filter: blur(0.2px);
        left: ${this.x}px;
        top: ${this.y}px;
        transform: none;
      `;
      document.body.appendChild(this.element);
    }

    update() {
      // Check if particle has exceeded its lifetime
      const currentTime = Date.now();
      const age = currentTime - this.birthTime;
      
      if (age >= config.particleLife) {
        return false; // Kill particle after 10 seconds
      }
      
      // Calculate remaining life as a percentage
      const lifeProgress = (config.particleLife - age) / config.particleLife;
      
      // Apply physics with ultra-smooth movement
      this.x += this.vx;
      this.y += this.vy;
      
      // Ultra-low turbulence for zero jitter
      this.vx += (Math.random() - 0.5) * config.turbulence;
      this.vy += (Math.random() - 0.5) * config.turbulence;
      
      // Apply viscous flow force for gradual deceleration
      this.vx *= config.flowForce;
      this.vy *= config.flowForce;
      
      // Very gentle gravity
      this.vy += config.gravity;
      
      // Calculate opacity with twinkling effect
      const baseOpacity = lifeProgress;
      const twinkle = Math.sin(this.twinklePhase) * 0.3 + 0.7; // Twinkle between 0.4 and 1.0
      this.opacity = baseOpacity * twinkle;
      
      // Update twinkle phase
      this.twinklePhase += config.twinkleSpeed;
      
      // Calculate size scaling in last 5 seconds
      let sizeMultiplier = 1;
      if (lifeProgress < 0.5) { // Last 5 seconds
        sizeMultiplier = lifeProgress * 2; // Scale from 0 to 1
      }
      
      // Apply size scaling
      this.size = this.initialSize * sizeMultiplier;
      
      // Update visual with smooth positioning and effects
      if (this.element) {
        const roundedX = Math.round(this.x);
        const roundedY = Math.round(this.y);
        this.element.style.left = `${roundedX}px`;
        this.element.style.top = `${roundedY}px`;
        this.element.style.width = `${this.size}px`;
        this.element.style.height = `${this.size}px`;
        this.element.style.opacity = this.opacity;
        this.element.style.boxShadow = `0 0 ${this.size * 3}px ${this.color}`;
        this.element.style.filter = `blur(0.2px) brightness(${0.9 + this.opacity * 0.1})`;
      }
      
      return true; // Particle is still alive
    }

    destroy() {
      if (this.element && this.element.parentNode) {
        this.element.parentNode.removeChild(this.element);
      }
    }
  }

  // Particle manager
  class ParticleManager {
    constructor() {
      this.particles = [];
      this.mouseX = null;
      this.mouseY = null;
      this.lastMouseX = null;
      this.lastMouseY = null;
      this.mouseVelocityX = 0;
      this.mouseVelocityY = 0;
      this.isMoving = false;
      this.moveTimeout = null;
      this.lastParticleTime = 0;
      this.hasInitialized = false;
      
      this.init();
    }

    init() {
      // Mouse move handler - optimized for performance
      let ticking = false;
      
      const updateMousePosition = (e) => {
        // Set initial position if this is the first mouse move
        if (!this.hasInitialized) {
          this.mouseX = e.clientX;
          this.mouseY = e.clientY;
          this.lastMouseX = e.clientX;
          this.lastMouseY = e.clientY;
          this.hasInitialized = true;
        } else {
          this.mouseX = e.clientX;
          this.mouseY = e.clientY;
        }
        
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(() => {
            this.handleMouseMove();
            ticking = false;
          });
        }
      };
      
      document.addEventListener('mousemove', updateMousePosition, { passive: true });
      
      // Touch support for mobile
      document.addEventListener('touchmove', (e) => {
        if (e.touches[0]) {
          if (!this.hasInitialized) {
            this.mouseX = e.touches[0].clientX;
            this.mouseY = e.touches[0].clientY;
            this.lastMouseX = e.touches[0].clientY;
            this.lastMouseY = e.touches[0].clientY;
            this.hasInitialized = true;
          } else {
            this.mouseX = e.touches[0].clientX;
            this.mouseY = e.touches[0].clientY;
          }
          
          if (!ticking) {
            ticking = true;
            requestAnimationFrame(() => {
              this.handleMouseMove();
              ticking = false;
            });
          }
        }
      }, { passive: true });

      // Animation loop
      this.animate();
    }

    handleMouseMove() {
      // Only proceed if we have valid mouse coordinates
      if (this.mouseX === null || this.mouseY === null) {
        return;
      }
      
      // Calculate mouse velocity for momentum
      const deltaX = this.mouseX - this.lastMouseX;
      const deltaY = this.mouseY - this.lastMouseY;
      const speed = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      
      // Store mouse velocity for momentum transfer (scaled down for slower movement)
      this.mouseVelocityX = deltaX * 0.15; // Reduced from 0.3
      this.mouseVelocityY = deltaY * 0.15;
      
      // Only create particles if mouse is moving and enough time has passed
      const now = Date.now();
      if (speed > 1 && now - this.lastParticleTime > 40) { // Slower spawning, higher threshold
        this.isMoving = true;
        this.createParticleTrail();
        this.lastParticleTime = now;
        
        // Clear the moving state after a short delay
        if (this.moveTimeout) clearTimeout(this.moveTimeout);
        this.moveTimeout = setTimeout(() => {
          this.isMoving = false;
        }, 120);
      }
      
      this.lastMouseX = this.mouseX;
      this.lastMouseY = this.mouseY;
    }

    createParticleTrail() {
      if (!this.isMoving || this.mouseX === null || this.mouseY === null) return;
      
      // Check if we're at the particle limit
      if (this.particles.length >= config.maxParticles) {
        return; // Don't create more particles if we're at the limit
      }
      
      // Create fewer particles for better performance
      const particleCount = Math.floor(Math.random() * 2) + 2; // 2-3 particles per spawn
      
      for (let i = 0; i < particleCount; i++) {
        // Check again in case we're approaching the limit
        if (this.particles.length >= config.maxParticles) {
          break;
        }
        
        // Spawn particles exactly at cursor with minimal offset
        const offsetX = (Math.random() - 0.5) * 4;
        const offsetY = (Math.random() - 0.5) * 4;
        
        // Initial velocity influenced by mouse movement (much slower)
        const baseVx = (Math.random() - 0.5) * config.particleSpeed.max;
        const baseVy = (Math.random() - 0.5) * config.particleSpeed.max;
        
        // Add gentle momentum influence ONLY at spawn
        const vx = baseVx + this.mouseVelocityX * 0.3;
        const vy = baseVy + this.mouseVelocityY * 0.3;
        
        const spawnX = Math.round(this.mouseX + offsetX);
        const spawnY = Math.round(this.mouseY + offsetY);
        
        const particle = new Particle(
          spawnX,
          spawnY,
          vx,
          vy,
          this.mouseVelocityX,
          this.mouseVelocityY
        );
        
        this.particles.push(particle);
      }
    }

    animate() {
      // Update and clean up particles
      this.particles = this.particles.filter(particle => {
        const alive = particle.update();
        if (!alive) {
          particle.destroy();
        }
        return alive;
      });

      requestAnimationFrame(() => this.animate());
    }
  }

  // Initialize the particle system only on home page
  new ParticleManager();
})();
