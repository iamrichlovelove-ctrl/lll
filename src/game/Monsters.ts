import * as THREE from 'three';

export type MonsterType = 'GHOST' | 'FUR' | 'WIND' | 'WORM';
export type SpawnLocation = 'normal' | 'close' | 'back';

export class Monster {
  public mesh: THREE.Group;
  public type: MonsterType;
  public isDead: boolean = false;
  public isElite: boolean = false;
  public hp: number = 1;
  public points: number = 1;
  
  public lastSkillTime: number = 0;
  public skillCooldown: number = 3000;
  public minSkillRange: number = 0;
  public maxSkillRange: number = 5;
  public skillType: string = '';
  
  private angle: number;
  private radius: number;
  private speed: number;
  private yOffset: number;
  private time: number = 0;
  private parts: THREE.Mesh[] = [];

  constructor(type: MonsterType, isElite: boolean = false, spawnLoc: SpawnLocation = 'normal') {
    this.type = type;
    this.isElite = isElite;
    this.mesh = new THREE.Group();
    
    if (spawnLoc === 'normal') {
      this.radius = 5 + Math.random() * 3; // 5 to 8
      this.angle = Math.random() * Math.PI * 2;
    } else if (spawnLoc === 'close') {
      this.radius = 2 + Math.random() * 2; // 2 to 4
      this.angle = Math.random() * Math.PI * 2;
    } else if (spawnLoc === 'back') {
      this.radius = 5 + Math.random() * 3;
      // Camera is at +Z, looking at origin. Back is around +Z.
      this.angle = Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 2);
    } else {
      this.radius = 5;
      this.angle = 0;
    }

    this.speed = 0.5 + Math.random() * 0.5;
    this.yOffset = 0.2 + Math.random() * 0.6;
    
    if (this.isElite) {
      this.hp = 3;
      this.points = 3;
      this.speed *= 1.3;
      this.skillType = 'smash';
      this.skillCooldown = 5000;
      this.minSkillRange = 0;
      this.maxSkillRange = 3;
    } else {
      switch (type) {
        case 'GHOST':
          this.skillType = 'fireball';
          this.skillCooldown = 3000;
          this.minSkillRange = 2;
          this.maxSkillRange = 6;
          break;
        case 'FUR':
          this.skillType = 'spike';
          this.skillCooldown = 4000;
          this.minSkillRange = 0;
          this.maxSkillRange = 4;
          break;
        case 'WIND':
          this.skillType = 'windblade';
          this.skillCooldown = 2500;
          this.minSkillRange = 0;
          this.maxSkillRange = 5;
          break;
        case 'WORM':
          this.skillType = 'poison';
          this.skillCooldown = 3500;
          this.minSkillRange = 0;
          this.maxSkillRange = 5;
          break;
      }
    }

    this.buildMesh();
    this.updatePosition();
  }

  private buildMesh() {
    switch (this.type) {
      case 'GHOST': {
        // 幽火灵: 圆球状半透明灵体 弱紫淡蓝渐变
        const geo = new THREE.SphereGeometry(0.5, 16, 16);
        const mat = new THREE.MeshStandardMaterial({
          color: 0x8a2be2,
          emissive: 0x4b0082,
          transparent: true,
          opacity: 0.8,
          wireframe: true
        });
        const mesh = new THREE.Mesh(geo, mat);
        this.parts.push(mesh);
        this.mesh.add(mesh);
        break;
      }
      case 'FUR': {
        // 影茸妖: 圆滚滚毛球 灰粉暗红渐变
        const geo = new THREE.DodecahedronGeometry(0.4, 1);
        const mat = new THREE.MeshStandardMaterial({
          color: 0xff69b4,
          emissive: 0x8b0000,
          transparent: true,
          opacity: 0.9,
          roughness: 0.8
        });
        const mesh = new THREE.Mesh(geo, mat);
        this.parts.push(mesh);
        this.mesh.add(mesh);
        break;
      }
      case 'WIND': {
        // 风屑妖: 细小光点与碎片聚合体 青白淡绿渐变
        const geo = new THREE.TetrahedronGeometry(0.3, 0);
        const mat = new THREE.MeshStandardMaterial({
          color: 0xe0ffff,
          emissive: 0x98fb98,
          transparent: true,
          opacity: 0.7
        });
        for (let i = 0; i < 3; i++) {
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.set((Math.random()-0.5)*0.5, (Math.random()-0.5)*0.5, (Math.random()-0.5)*0.5);
          this.parts.push(mesh);
          this.mesh.add(mesh);
        }
        this.speed *= 1.5; // Faster
        break;
      }
      case 'WORM': {
        // 咒影虫: 弯曲长条灵虫 暗紫柔光
        const geo = new THREE.CapsuleGeometry(0.2, 0.6, 4, 8);
        const mat = new THREE.MeshStandardMaterial({
          color: 0x483d8b,
          emissive: 0x2f4f4f,
          transparent: true,
          opacity: 0.8
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.z = Math.PI / 2;
        this.parts.push(mesh);
        this.mesh.add(mesh);
        break;
      }
    }
    if (this.isElite) {
      this.mesh.scale.set(1.5, 1.5, 1.5);
      // Add a red aura for elites
      const auraGeo = new THREE.SphereGeometry(0.7, 16, 16);
      const auraMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.3, side: THREE.BackSide });
      const aura = new THREE.Mesh(auraGeo, auraMat);
      this.mesh.add(aura);
    }
  }

  public update(dt: number) {
    this.time += dt;
    
    if (this.isElite) {
      // Elite moves towards player (radius decreases)
      this.radius -= this.speed * dt * 0.5;
      if (this.radius < 1.5) this.radius = 1.5; // Don't get too close
      // Slowly rotate around as well
      this.angle += this.speed * dt * 0.1;
    } else {
      this.angle += this.speed * dt * 0.5;
    }
    
    this.updatePosition();

    // Animations
    if (this.type === 'GHOST') {
      const scale = 1 + Math.sin(this.time * 3) * 0.1;
      this.mesh.scale.set(scale, scale, scale);
    } else if (this.type === 'FUR') {
      this.mesh.position.y += Math.abs(Math.sin(this.time * 5)) * 0.5;
    } else if (this.type === 'WIND') {
      this.parts.forEach((p, i) => {
        p.rotation.x += dt * (i + 1);
        p.rotation.y += dt * (i + 1);
      });
    } else if (this.type === 'WORM') {
      this.mesh.rotation.y = -this.angle;
      this.parts[0].rotation.z = Math.PI / 2 + Math.sin(this.time * 5) * 0.2;
    }
  }

  private updatePosition() {
    this.mesh.position.x = Math.cos(this.angle) * this.radius;
    this.mesh.position.z = Math.sin(this.angle) * this.radius;
    this.mesh.position.y = this.yOffset + Math.sin(this.time * 2) * 0.3;
  }
}
