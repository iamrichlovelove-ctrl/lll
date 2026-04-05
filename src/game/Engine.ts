import * as THREE from 'three';
import { Monster, MonsterType } from './Monsters';
import { GestureType } from './HandTracker';

export class Engine {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private monsters: Monster[] = [];
  private particles: THREE.Points[] = [];
  private spells: THREE.Object3D[] = [];
  
  private lastTime: number = 0;
  private isRunning: boolean = false;
  private specialEvent: string | null = null;
  
  public invincibleUntil: number = 0;
  public poisonTimer: any = null;
  public overpopulationTimer: number = 0;
  public projectiles: any[] = [];
  public enableSkills: boolean = true;
  
  public onKill: (points: number) => void = () => {};
  public onPlayerHit: (amount: number) => void = () => {};
  public onOverpopulation: (isOver: boolean) => void = () => {};
  public onSkillPenalty: (extraCd: number) => void = () => {};
  public onDamageFlash: () => void = () => {};

  public playerTakeDamage(amount: number, source: string) {
    const now = Date.now();
    if (now < this.invincibleUntil) return;
    
    this.invincibleUntil = now + 500;
    this.onPlayerHit(amount);
    this.onDamageFlash();
  }

  public applyPoison() {
    if (this.poisonTimer) clearInterval(this.poisonTimer);
    let ticks = 0;
    this.poisonTimer = setInterval(() => {
      ticks++;
      this.onPlayerHit(0.5);
      this.onDamageFlash();
      if (ticks >= 2) {
        clearInterval(this.poisonTimer);
        this.poisonTimer = null;
      }
    }, 1000);
  }

  public setSpecialEvent(event: string | null) {
    this.specialEvent = event;
    // Apply translucent effect immediately
    this.monsters.forEach(m => {
      m.mesh.children.forEach(c => {
        if (c instanceof THREE.Mesh && c.material instanceof THREE.Material) {
          c.material.opacity = this.specialEvent === '怪物半透明' ? 0.3 : 0.8;
        }
      });
    });
  }

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x02111f);
    this.scene.fog = new THREE.FogExp2(0x02111f, 0.05);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 2.5, 10);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.2);
    this.scene.add(ambient);
    
    const blueLight = new THREE.PointLight(0x4444ff, 2, 20);
    blueLight.position.set(-5, 5, 5);
    this.scene.add(blueLight);
    
    const redLight = new THREE.PointLight(0xff4444, 2, 20);
    redLight.position.set(5, 5, 5);
    this.scene.add(redLight);

    // Ground
    // Removed grid helper as requested
    
    // Stars
    this.createStars();

    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  private createStars() {
    const geo = new THREE.BufferGeometry();
    const count = 600;
    const pos = new Float32Array(count * 3);
    for(let i=0; i<count*3; i++) {
      pos[i] = (Math.random() - 0.5) * 40;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, transparent: true, opacity: 0.6 });
    const stars = new THREE.Points(geo, mat);
    this.scene.add(stars);
  }

  private onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    this.animate();
  }

  public stop() {
    this.isRunning = false;
  }

  public reset() {
    this.monsters.forEach(m => this.scene.remove(m.mesh));
    this.monsters = [];
    this.spells.forEach(s => this.scene.remove(s));
    this.spells = [];
    this.particles.forEach(p => this.scene.remove(p));
    this.particles = [];
  }

  public spawnMonster(isElite: boolean = false, spawnLoc: 'normal' | 'close' | 'back' = 'normal') {
    if (this.monsters.length >= 35) return;
    const types: MonsterType[] = ['GHOST', 'FUR', 'WIND', 'WORM'];
    const type = types[Math.floor(Math.random() * types.length)];
    const monster = new Monster(type, isElite, spawnLoc);
    
    if (this.specialEvent === '怪物半透明') {
      monster.mesh.children.forEach(c => {
        if (c instanceof THREE.Mesh && c.material instanceof THREE.Material) {
          c.material.opacity = 0.3;
        }
      });
    }

    this.monsters.push(monster);
    this.scene.add(monster.mesh);
  }

  public castSpell(gesture: GestureType) {
    if (gesture === 'NONE' || gesture === 'FIST') return;

    // Create visual effect
    const spellObj = new THREE.Group();
    this.scene.add(spellObj);
    this.spells.push(spellObj);
    
    // Auto remove spell after 0.5s
    setTimeout(() => {
      this.scene.remove(spellObj);
      this.spells = this.spells.filter(s => s !== spellObj);
    }, 500);

    let hitCount = 0;

    if (gesture === 'ALL') {
      // Screen wide flash
      const geo = new THREE.SphereGeometry(20, 32, 32);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
      const mesh = new THREE.Mesh(geo, mat);
      spellObj.add(mesh);

      // Kill all monsters
      const monstersToKill = [...this.monsters];
      monstersToKill.forEach(m => {
        if (this.killMonster(m, true)) {
          hitCount++;
        }
      });
    } else if (gesture === 'THUNDER') {
      // 雷诀击杀一只怪物
      const geo = new THREE.CylinderGeometry(0.75, 0.75, 20, 8);
      const mat = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.5 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.z = -10;
      spellObj.add(mesh);

      const hitCandidates = this.monsters.filter(m => Math.abs(m.mesh.position.x) < 1.5 && m.mesh.position.z < 0);
      if (hitCandidates.length > 0) {
        // Kill the closest one
        hitCandidates.sort((a, b) => a.mesh.position.length() - b.mesh.position.length());
        this.killMonster(hitCandidates[0]);
        hitCount++;
      }
    } else if (gesture === 'FIRE') {
      // 火诀两只
      const hitCandidates = [...this.monsters];
      hitCandidates.sort((a, b) => a.mesh.position.length() - b.mesh.position.length());
      
      const targets = hitCandidates.slice(0, 2);
      targets.forEach(target => {
        const geo = new THREE.SphereGeometry(1, 16, 16);
        const mat = new THREE.MeshBasicMaterial({ color: 0xff4500, transparent: true, opacity: 0.7 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(target.mesh.position);
        spellObj.add(mesh);
        
        this.killMonster(target);
        hitCount++;
      });
    } else if (gesture === 'WIND') {
      // 风诀一只
      const geo = new THREE.SphereGeometry(3.5, 32, 32);
      const mat = new THREE.MeshBasicMaterial({ color: 0x98fb98, transparent: true, opacity: 0.3, wireframe: true });
      const mesh = new THREE.Mesh(geo, mat);
      spellObj.add(mesh);

      const hitCandidates = this.monsters.filter(m => m.mesh.position.length() <= 3.5);
      if (hitCandidates.length > 0) {
        hitCandidates.sort((a, b) => a.mesh.position.length() - b.mesh.position.length());
        this.killMonster(hitCandidates[0]);
        hitCount++;
      }
    } else if (gesture === 'SHADOW') {
      // 阴诀三只
      const geo = new THREE.CylinderGeometry(0.4, 0.4, 40, 8);
      const mat = new THREE.MeshBasicMaterial({ color: 0x8a2be2, transparent: true, opacity: 0.6 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.z = -20;
      spellObj.add(mesh);

      const hitCandidates = this.monsters.filter(m => Math.abs(m.mesh.position.x) < 0.8 && m.mesh.position.z < 0);
      hitCandidates.sort((a, b) => a.mesh.position.length() - b.mesh.position.length());
      
      const targets = hitCandidates.slice(0, 3);
      targets.forEach(target => {
        this.killMonster(target);
        hitCount++;
      });
    }

    return hitCount;
  }

  private checkOverpopulationDamage(dt: number) {
    if (this.monsters.length > 30) {
      this.onOverpopulation(true);
      this.overpopulationTimer += dt;
      if (this.overpopulationTimer >= 1.5) {
        this.overpopulationTimer = 0;
        this.playerTakeDamage(1, 'overpopulation');
      }
    } else {
      this.onOverpopulation(false);
      this.overpopulationTimer = 0;
    }
  }

  private updateMonstersSkills(now: number) {
    if (!this.enableSkills) return;
    this.monsters.forEach(m => {
      const dist = m.mesh.position.length();
      if (dist >= m.minSkillRange && dist <= m.maxSkillRange) {
        if (now - m.lastSkillTime > m.skillCooldown) {
          m.lastSkillTime = now;
          this.castMonsterSkill(m);
        }
      }
    });
  }

  private castMonsterSkill(m: Monster) {
    const type = m.skillType;
    if (type === 'fireball') {
      const warnGeo = new THREE.RingGeometry(0.8, 1, 16);
      const warnMat = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
      const warnMesh = new THREE.Mesh(warnGeo, warnMat);
      warnMesh.rotation.x = -Math.PI / 2;
      warnMesh.position.set(0, 0.01, 0);
      this.scene.add(warnMesh);
      setTimeout(() => this.scene.remove(warnMesh), 500);

      const geo = new THREE.SphereGeometry(0.3, 8, 8);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffa500 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(m.mesh.position);
      this.scene.add(mesh);
      this.projectiles.push({ mesh, type: 'fireball', speed: 10, damage: 1 });
    } else if (type === 'spike') {
      const warnGeo = new THREE.RingGeometry(0.8, 1, 16);
      const warnMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
      const warnMesh = new THREE.Mesh(warnGeo, warnMat);
      warnMesh.rotation.x = -Math.PI / 2;
      warnMesh.position.set(0, 0.01, 0);
      this.scene.add(warnMesh);
      
      setTimeout(() => {
        this.scene.remove(warnMesh);
        const geo = new THREE.ConeGeometry(0.5, 2, 8);
        const mat = new THREE.MeshBasicMaterial({ color: 0x333333 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(0, 1, 0);
        this.scene.add(mesh);
        this.playerTakeDamage(1, 'spike');
        setTimeout(() => this.scene.remove(mesh), 300);
      }, 500);
    } else if (type === 'windblade') {
      const geo = new THREE.BoxGeometry(1, 0.1, 0.5);
      const mat = new THREE.MeshBasicMaterial({ color: 0x98fb98, transparent: true, opacity: 0.8 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(m.mesh.position);
      this.scene.add(mesh);
      this.projectiles.push({ mesh, type: 'windblade', speed: 15, damage: 1, rotSpeed: 10 });
    } else if (type === 'poison') {
      const geo = new THREE.SphereGeometry(0.4, 8, 8);
      const mat = new THREE.MeshBasicMaterial({ color: 0x800080 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(m.mesh.position);
      this.scene.add(mesh);
      this.projectiles.push({ mesh, type: 'poison', speed: 8, damage: 1 });
    } else if (type === 'smash') {
      const warnGeo = new THREE.RingGeometry(3, 3.5, 32);
      const warnMat = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide, transparent: true, opacity: 0.3 });
      const warnMesh = new THREE.Mesh(warnGeo, warnMat);
      warnMesh.rotation.x = -Math.PI / 2;
      warnMesh.position.copy(m.mesh.position);
      warnMesh.position.y = 0.01;
      this.scene.add(warnMesh);

      setTimeout(() => {
        this.scene.remove(warnMesh);
        const waveGeo = new THREE.RingGeometry(0.1, 3.5, 32);
        const waveMat = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
        const waveMesh = new THREE.Mesh(waveGeo, waveMat);
        waveMesh.rotation.x = -Math.PI / 2;
        waveMesh.position.copy(m.mesh.position);
        waveMesh.position.y = 0.02;
        this.scene.add(waveMesh);
        
        if (m.mesh.position.length() <= 3.5) {
          this.playerTakeDamage(2, 'smash');
          this.onSkillPenalty(500);
        }

        setTimeout(() => this.scene.remove(waveMesh), 200);
      }, 500);
    }
  }

  private killMonster(m: Monster, instantKill: boolean = false): boolean {
    if (!instantKill && m.hp > 1) {
      m.hp -= 1;
      // Flash red
      m.mesh.children.forEach(c => {
        if (c instanceof THREE.Mesh && c.material instanceof THREE.MeshStandardMaterial) {
          const oldEmissive = c.material.emissive.getHex();
          c.material.emissive.setHex(0xff0000);
          setTimeout(() => {
            if (!m.isDead) c.material.emissive.setHex(oldEmissive);
          }, 100);
        }
      });
      return false;
    }

    m.isDead = true;
    this.scene.remove(m.mesh);
    this.createDeathParticles(m.mesh.position, m.type);
    this.onKill(m.points);
    return true;
  }

  private createDeathParticles(pos: THREE.Vector3, type: MonsterType) {
    const geo = new THREE.BufferGeometry();
    const count = 20;
    const positions = new Float32Array(count * 3);
    const velocities = [];
    for(let i=0; i<count; i++) {
      positions[i*3] = pos.x;
      positions[i*3+1] = pos.y;
      positions[i*3+2] = pos.z;
      velocities.push(new THREE.Vector3((Math.random()-0.5)*2, (Math.random()-0.5)*2, (Math.random()-0.5)*2));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    let color = 0xffffff;
    if (type === 'GHOST') color = 0x8a2be2;
    if (type === 'FUR') color = 0xff69b4;
    if (type === 'WIND') color = 0xe0ffff;
    if (type === 'WORM') color = 0x483d8b;

    const mat = new THREE.PointsMaterial({ color, size: 0.2, transparent: true, opacity: 1 });
    const points = new THREE.Points(geo, mat);
    (points as any).userData = { velocities, age: 0 };
    
    this.scene.add(points);
    this.particles.push(points);
  }

  private animate() {
    if (!this.isRunning) return;
    requestAnimationFrame(this.animate.bind(this));

    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    if (this.specialEvent === '怪物减速') {
      dt *= 0.5;
    }

    this.checkOverpopulationDamage(dt);
    this.updateMonstersSkills(Date.now());

    // Update monsters
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const m = this.monsters[i];
      if (m.isDead) {
        this.monsters.splice(i, 1);
        continue;
      }
      m.update(dt);
      
      if (m.mesh.position.length() < 0.8) {
        this.playerTakeDamage(1, 'touch');
        this.scene.remove(m.mesh);
        this.monsters.splice(i, 1);
      }
    }

    // Update projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const dir = new THREE.Vector3(0, 0, 0).sub(p.mesh.position).normalize();
      p.mesh.position.add(dir.multiplyScalar(p.speed * dt));
      
      if (p.rotSpeed) {
        p.mesh.rotation.y += p.rotSpeed * dt;
      }
      
      if (p.mesh.position.length() < 0.5) {
        this.playerTakeDamage(p.damage, p.type);
        if (p.type === 'poison') {
          this.applyPoison();
        }
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }

    // Auto kill event
    if (this.specialEvent === '自动杀怪' && Math.random() < 0.02 && this.monsters.length > 0) {
      const idx = Math.floor(Math.random() * this.monsters.length);
      this.killMonster(this.monsters[idx], true);
    }

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      const data = p.userData;
      data.age += dt;
      if (data.age > 0.5) {
        this.scene.remove(p);
        this.particles.splice(i, 1);
        continue;
      }
      
      const positions = p.geometry.attributes.position.array as Float32Array;
      for(let j=0; j<data.velocities.length; j++) {
        positions[j*3] += data.velocities[j].x * dt;
        positions[j*3+1] += data.velocities[j].y * dt;
        positions[j*3+2] += data.velocities[j].z * dt;
      }
      p.geometry.attributes.position.needsUpdate = true;
      (p.material as THREE.PointsMaterial).opacity = 1 - (data.age / 0.5);
    }

    this.renderer.render(this.scene, this.camera);
  }
}
