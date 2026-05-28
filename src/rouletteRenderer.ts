import type { Camera } from './camera';
import { canvasHeight, canvasWidth, initialZoom, Themes } from './data/constants';
import type { StageDef } from './data/maps';
import type { GameObject } from './gameObject';
import { KeywordService } from './keywordService';
import type { Marble } from './marble';
import type { ParticleManager } from './particleManager';
import type { ColorTheme } from './types/ColorTheme';
import type { MapEntityState } from './types/MapEntity.type';
import type { VectorLike } from './types/VectorLike';
import type { UIObject } from './UIObject';

export type RenderParameters = {
  camera: Camera;
  stage: StageDef;
  entities: MapEntityState[];
  marbles: Marble[];
  winners: Marble[];
  particleManager: ParticleManager;
  effects: GameObject[];
  winnerRank: number;
  winner: Marble | null;
  size: VectorLike;
  theme: ColorTheme;
};

export class RouletteRenderer {
  protected _canvas!: HTMLCanvasElement;
  protected ctx!: CanvasRenderingContext2D;
  public sizeFactor = 1;

  protected _images: { [key: string]: HTMLImageElement } = {};
  protected _theme: ColorTheme = Themes.dark;
  protected _keywordService: KeywordService;
  private _backgroundImage: HTMLImageElement | null = null;
  private _bgMarginX: number = 0; // fraction of canvas width, per side (negative = crop/zoom in)
  private _bgMarginY: number = 0; // fraction of canvas height, per side
  private _winnerImage: HTMLImageElement | null = null;
  private _customMarbleImages: Map<string, HTMLCanvasElement> = new Map();

  setBackgroundImage(img: HTMLImageElement | null): void {
    this._backgroundImage = img;
  }

  setBackgroundImageMargin(x: number, y: number): void {
    this._bgMarginX = x;
    this._bgMarginY = y;
  }

  setWinningImage(img: HTMLImageElement | null): void {
    this._winnerImage = img;
  }

  setCustomMarbleImage(name: string, img: HTMLImageElement): void {
    if (!img.naturalWidth || !img.naturalHeight) return;
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    this._customMarbleImages.set(name, canvas);
  }

  clearCustomMarbleImages(): void {
    this._customMarbleImages.clear();
  }

  constructor() {
    this._keywordService = this.createKeywordService();
  }

  protected createKeywordService(): KeywordService {
    return new KeywordService();
  }

  get width() {
    return this._canvas.width;
  }

  get height() {
    return this._canvas.height;
  }

  get canvas() {
    return this._canvas;
  }

  set theme(value: ColorTheme) {
    this._theme = value;
  }

  async init() {
    await Promise.all([this._load(), this._keywordService.init()]);

    this._canvas = document.createElement('canvas');
    this._canvas.width = canvasWidth;
    this._canvas.height = canvasHeight;
    this.ctx = this._canvas.getContext('2d', {
      alpha: false,
    }) as CanvasRenderingContext2D;

    document.body.appendChild(this._canvas);

    const resizing = (entries?: ResizeObserverEntry[]) => {
      const realSize = entries ? entries[0].contentRect : this._canvas.getBoundingClientRect();
      const width = Math.max(realSize.width / 2, 640);
      const height = (width / realSize.width) * realSize.height;
      this._canvas.width = width;
      this._canvas.height = height;
      this.sizeFactor = width / realSize.width;
    };

    const resizeObserver = new ResizeObserver(resizing);

    resizeObserver.observe(this._canvas);
    resizing();
  }

  private async _loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((rs) => {
      const img = new Image();
      img.addEventListener('load', () => {
        rs(img);
      });
      img.src = url;
    });
  }

  private async _load(): Promise<void> {
    const loadPromises = [
      { name: '챔루', imgUrl: new URL('../assets/images/chamru.png', import.meta.url) },
      { name: '쿠빈', imgUrl: new URL('../assets/images/kubin.png', import.meta.url) },
      { name: '꽉변', imgUrl: new URL('../assets/images/kkwak.png', import.meta.url) },
      { name: '꽉변호사', imgUrl: new URL('../assets/images/kkwak.png', import.meta.url) },
      { name: '꽉 변호사', imgUrl: new URL('../assets/images/kkwak.png', import.meta.url) },
      { name: '주누피', imgUrl: new URL('../assets/images/junyoop.png', import.meta.url) },
      { name: '왈도쿤', imgUrl: new URL('../assets/images/waldokun.png', import.meta.url) },
    ].map(({ name, imgUrl }) => {
      return (async () => {
        this._images[name] = await this._loadImage(imgUrl.toString());
      })();
    });

    loadPromises.push(
      (async () => {
        await this._loadImage(new URL('../assets/images/ff.svg', import.meta.url).toString());
      })()
    );

    await Promise.all(loadPromises);
  }

  private getMarbleImage(name: string): CanvasImageSource | undefined {
    // Priority 0: User-uploaded custom photo
    const custom = this._customMarbleImages.get(name);
    if (custom) return custom;
    // Priority 1: Hardcoded images
    if (this._images[name]) {
      return this._images[name];
    }
    // Priority 2: Keyword sprites from API
    return this._keywordService.getSprite(name);
  }

  protected onBeforeEntities(): void {}
  protected onAfterScene(): void {}

  render(renderParameters: RenderParameters, uiObjects: UIObject[]) {
    this._theme = renderParameters.theme;
    this.ctx.fillStyle = this._theme.background;
    this.ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);

    if (this._backgroundImage) {
      const cw = this._canvas.width;
      const ch = this._canvas.height;
      // Margin in pixels per side (negative = image extends past canvas edge = crop/zoom)
      const mx = this._bgMarginX * cw;
      const my = this._bgMarginY * ch;
      const availX = mx;
      const availY = my;
      const availW = cw - mx * 2;
      const availH = ch - my * 2;
      const imgAspect = this._backgroundImage.naturalWidth / this._backgroundImage.naturalHeight;
      const availAspect = availW / availH;
      let drawW: number, drawH: number;
      if (imgAspect > availAspect) {
        drawW = availW;
        drawH = availW / imgAspect;
      } else {
        drawH = availH;
        drawW = availH * imgAspect;
      }
      const drawX = availX + (availW - drawW) / 2;
      const drawY = availY + (availH - drawH) / 2;
      this.ctx.fillStyle = 'black';
      this.ctx.fillRect(0, 0, cw, ch);
      this.ctx.drawImage(this._backgroundImage, drawX, drawY, drawW, drawH);
    }

    this.ctx.save();
    this.ctx.scale(initialZoom, initialZoom);
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';
    this.ctx.font = '0.4pt sans-serif';
    this.ctx.lineWidth = 3 / (renderParameters.camera.zoom + initialZoom);
    renderParameters.camera.renderScene(this.ctx, () => {
      this.onBeforeEntities();
      this.renderEntities(renderParameters.entities);
      this.renderEffects(renderParameters);
      this.renderMarbles(renderParameters);
    });
    this.ctx.restore();
    this.onAfterScene();

    uiObjects.forEach((obj) => obj.render(this.ctx, renderParameters, this._canvas.width, this._canvas.height));
    renderParameters.particleManager.render(this.ctx);
    this.renderWinner(renderParameters);
  }

  private renderEntities(entities: MapEntityState[]) {
    this.ctx.save();
    entities.forEach((entity) => {
      const transform = this.ctx.getTransform();
      this.ctx.translate(entity.x, entity.y);
      this.ctx.rotate(entity.angle);
      this.ctx.fillStyle = entity.shape.color ?? this._theme.entity[entity.shape.type].fill;
      this.ctx.strokeStyle = entity.shape.color ?? this._theme.entity[entity.shape.type].outline;
      this.ctx.shadowBlur = this._theme.entity[entity.shape.type].bloomRadius;
      this.ctx.shadowColor =
        entity.shape.bloomColor ?? entity.shape.color ?? this._theme.entity[entity.shape.type].bloom;
      const shape = entity.shape;
      switch (shape.type) {
        case 'polyline':
          if (shape.points.length > 0) {
            this.ctx.beginPath();
            this.ctx.moveTo(shape.points[0][0], shape.points[0][1]);
            for (let i = 1; i < shape.points.length; i++) {
              this.ctx.lineTo(shape.points[i][0], shape.points[i][1]);
            }
            this.ctx.stroke();
          }
          break;
        case 'box': {
          const w = shape.width * 2;
          const h = shape.height * 2;
          this.ctx.rotate(shape.rotation);
          this.ctx.fillRect(-w / 2, -h / 2, w, h);
          this.ctx.strokeRect(-w / 2, -h / 2, w, h);
          break;
        }
        case 'circle':
          this.ctx.beginPath();
          this.ctx.arc(0, 0, shape.radius, 0, Math.PI * 2, false);
          this.ctx.stroke();
          break;
      }

      this.ctx.setTransform(transform);
    });
    this.ctx.restore();
  }

  private renderEffects({ effects, camera }: RenderParameters) {
    effects.forEach((effect) => effect.render(this.ctx, camera.zoom * initialZoom, this._theme));
  }

  private renderMarbles({ marbles, camera, winnerRank, winners, size }: RenderParameters) {
    const winnerIndex = winnerRank - winners.length;

    const viewPort = { x: camera.x, y: camera.y, w: size.x, h: size.y, zoom: camera.zoom * initialZoom };
    marbles.forEach((marble, i) => {
      marble.render(
        this.ctx,
        camera.zoom * initialZoom,
        i === winnerIndex,
        false,
        this.getMarbleImage(marble.name),
        viewPort,
        this._theme
      );
    });
  }

  private renderWinner({ winner, theme }: RenderParameters) {
    if (!winner) return;
    if (this._winnerImage) {
      this._renderWinnerOverlay(winner, theme);
    } else {
      this._renderWinnerPanel(winner, theme);
    }
  }

  private _renderWinnerPanel(winner: Marble, theme: ColorTheme) {
    this.ctx.save();
    this.ctx.fillStyle = theme.winnerBackground;
    this.ctx.fillRect(this._canvas.width / 2, this._canvas.height - 168, this._canvas.width / 2, 168);

    const marbleSize = 100;
    const marbleCenterX = this._canvas.width - marbleSize / 2 - 20;
    const marbleCenterY = this._canvas.height - 168 / 2;
    const marbleImage = this.getMarbleImage(winner.name);

    if (marbleImage) {
      this.ctx.drawImage(
        marbleImage,
        marbleCenterX - marbleSize / 2,
        marbleCenterY - marbleSize / 2,
        marbleSize,
        marbleSize
      );
    } else {
      this.ctx.beginPath();
      this.ctx.arc(marbleCenterX, marbleCenterY, marbleSize / 2, 0, Math.PI * 2);
      this.ctx.fillStyle = `hsl(${winner.hue} 100% ${theme.marbleLightness})`;
      this.ctx.fill();
    }

    this.ctx.fillStyle = theme.winnerText;
    this.ctx.strokeStyle = theme.winnerOutline;
    this.ctx.font = 'bold 48px sans-serif';
    this.ctx.textAlign = 'right';
    this.ctx.lineWidth = 4;
    const textRightX = marbleCenterX - marbleSize / 2 - 20;
    if (theme.winnerOutline) {
      this.ctx.strokeText('Winner', textRightX, this._canvas.height - 120);
    }
    this.ctx.fillText('Winner', textRightX, this._canvas.height - 120);
    this.ctx.font = 'bold 72px sans-serif';
    this.ctx.fillStyle = `hsl(${winner.hue} 100% ${theme.marbleLightness})`;
    if (theme.winnerOutline) {
      this.ctx.strokeText(winner.name, textRightX, this._canvas.height - 55);
    }
    this.ctx.fillText(winner.name, textRightX, this._canvas.height - 55);
    this.ctx.restore();
  }

  private _renderWinnerOverlay(winner: Marble, theme: ColorTheme) {
    const ctx = this.ctx;
    const w = this._canvas.width;
    const h = this._canvas.height;
    const img = this._winnerImage!;

    ctx.save();

    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(0, 0, w, h);

    // Content area: 90% width, centred, with top/bottom margins
    const margin = Math.round(w * 0.05);
    const contentW = w - margin * 2;
    const contentX = margin;
    const contentY = Math.round(h * 0.05);
    const contentH = h - contentY * 2;

    // 50 / 50 column split
    const colGap = Math.round(w * 0.025);
    const colW = Math.round((contentW - colGap) / 2);

    // ── LEFT COLUMN: winning image ──────────────────────────────────
    const aspect = img.naturalWidth / img.naturalHeight;
    let imgW = colW;
    let imgH = imgW / aspect;
    if (imgH > contentH) {
      imgH = contentH;
      imgW = imgH * aspect;
    }
    const imgX = contentX + (colW - imgW) / 2;
    const imgY = contentY + (contentH - imgH) / 2;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.60)';
    ctx.lineWidth = 3;
    ctx.strokeRect(imgX - 2, imgY - 2, imgW + 4, imgH + 4);
    ctx.drawImage(img, imgX, imgY, imgW, imgH);

    // ── RIGHT COLUMN: Winner label → marble icon → winner name ──────
    const rightColX = contentX + colW + colGap;
    const rightCenterX = rightColX + colW / 2;

    // "🏆 Winner" label at the very top of the right column
    const titleH = Math.max(44, Math.round(contentH * 0.14));
    ctx.fillStyle = 'rgba(0, 0, 0, 0.82)';
    this._fillRoundRect(ctx, rightColX, contentY, colW, titleH, 10);
    ctx.fillStyle = '#FFD700';
    ctx.font = `bold ${Math.round(titleH * 0.52)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏆  Winner', rightCenterX, contentY + titleH / 2);

    // Marble icon below the label (takes ~48% of remaining column height)
    const marbleImg = this.getMarbleImage(winner.name);
    const iconAreaY = contentY + titleH + 10;
    const iconAreaH = Math.round(contentH * 0.48);
    const iconSize = Math.min(colW * 0.78, iconAreaH * 0.90);
    const iconCenterX = rightCenterX;
    const iconCenterY = iconAreaY + iconAreaH / 2;

    ctx.save();
    ctx.beginPath();
    ctx.arc(iconCenterX, iconCenterY, iconSize / 2, 0, Math.PI * 2);
    if (marbleImg) {
      ctx.clip();
      ctx.drawImage(marbleImg, iconCenterX - iconSize / 2, iconCenterY - iconSize / 2, iconSize, iconSize);
    } else {
      ctx.fillStyle = `hsl(${winner.hue} 100% ${theme.marbleLightness})`;
      ctx.fill();
    }
    ctx.restore();

    // Icon border ring
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(iconCenterX, iconCenterY, iconSize / 2, 0, Math.PI * 2);
    ctx.stroke();

    // Winner name below the icon — auto-fit to column width
    const nameAreaY = iconAreaY + iconAreaH + 10;
    const nameAreaH = contentY + contentH - nameAreaY;
    let fontSize = Math.min(Math.round(nameAreaH * 0.65), Math.round(colW * 0.40), 80);
    ctx.font = `bold ${fontSize}px sans-serif`;
    const measured = ctx.measureText(winner.name);
    if (measured.width > colW * 0.95) {
      fontSize = Math.floor(fontSize * ((colW * 0.95) / measured.width));
      ctx.font = `bold ${fontSize}px sans-serif`;
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `hsl(${winner.hue} 100% ${theme.marbleLightness})`;
    if (theme.winnerOutline) {
      ctx.strokeStyle = theme.winnerOutline;
      ctx.lineWidth = Math.max(3, Math.round(fontSize / 12));
      ctx.strokeText(winner.name, rightCenterX, nameAreaY + nameAreaH / 2);
    }
    ctx.fillText(winner.name, rightCenterX, nameAreaY + nameAreaH / 2);

    ctx.restore();
  }

  private _fillRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.fill();
  }
}
