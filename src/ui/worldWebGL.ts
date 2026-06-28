/**
 * Задел WebGL-рендера мира (фаза 5).
 * Сейчас не подключён к UI — после стабилизации ImageData-рендера
 * можно перенести сюда отрисовку через текстуры (клетки / свет / минералы).
 */
import { WORLD } from '../sim/config'

export interface WorldGlTextures {
  /** RGBA8: тип ткани / plant id */
  cells: WebGLTexture
  /** R32F: энергия клетки */
  energy: WebGLTexture
  /** R32F: минералы почвы */
  minerals: WebGLTexture
  /** R32F: свет */
  light: WebGLTexture
}

export class WorldWebGLRenderer {
  private gl: WebGL2RenderingContext
  private program: WebGLProgram | null = null
  private quadVao: WebGLVertexArrayObject | null = null

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false })
    if (!gl) throw new Error('WebGL2 не поддерживается')
    this.gl = gl
  }

  /** Инициализация шейдеров и fullscreen quad (TODO: реализовать при переходе с Canvas 2D). */
  init(): boolean {
    return false
  }

  /** Загрузить снимок мира в GPU-текстуры (TODO). */
  uploadWorld(_textures: Partial<WorldGlTextures>): void {
    // placeholder для будущей интеграции
  }

  /** Отрисовать мир в текущий viewport (TODO). */
  draw(_displayW: number, _displayH: number): void {
    const gl = this.gl
    gl.viewport(0, 0, WORLD.W, WORLD.H)
  }

  dispose(): void {
    const gl = this.gl
    if (this.program) gl.deleteProgram(this.program)
    if (this.quadVao) gl.deleteVertexArray(this.quadVao)
  }
}

export function isWebGL2Available(): boolean {
  if (typeof document === 'undefined') return false
  const c = document.createElement('canvas')
  return c.getContext('webgl2') != null
}
