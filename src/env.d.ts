/// <reference types="astro/client" />
declare namespace App {
  interface Locals { adminUser?: { username: string; role: 'administrador' | 'catalogador' | 'revisor' | 'consulta' }; }
}
