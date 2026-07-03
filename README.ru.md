<div align="center">

# Illustration Editor

**SVG-редактор иллюстраций для учебника по электронике**


</div>

Векторный редактор иллюстраций на основе canvas, созданный для курса "From Charge to HTML" (`presentation-charge-to-html`). Иллюстрации хранятся в JSON с семантическими цветовыми ролями вместо конкретных цветов, поэтому каждый рисунок отображается в светлой и тёмной теме и синхронизирован с палитрой Catppuccin книги на Typst. Dev-сервер Vite дополнительно работает как небольшой REST API: сохраняет рисунки и автоматически перекомпилирует книгу при каждом изменении.

## ■ Возможности

- ❖ **Canvas editor** — инструменты circle, rect, line, arrow, cubic bezier и text на react-konva сцене; выделение/трансформация, сетка, привязка к сетке, undo/redo и горячие клавиши copy/paste/duplicate
- ❖ **Dual theme** — рисунки используют цветовые роли (`fg`, `bg`, `muted`, `accent` + шаги прозрачности), разрешаемые по теме, с живым сравнительным превью light/dark
- ❖ **Science palette** — акцентные оттенки привязаны к дисциплинам (math, physics, chemistry, electronics, cs), а также `red` и `default`, с опциональными переопределениями на уровне элемента; цвета синхронизированы с `template.typ` книги
- ❖ **JSON storage** — каждая иллюстрация — это JSON-файл; при сохранении также записываются `.light.svg` / `.dark.svg`, а `generate-svgs.mjs` пакетно перегенерирует оба SVG для каждого рисунка
- ❖ **Live Typst build** — API dev-сервера следит за `.typ`-файлами и перекомпилирует `main.pdf` + `main-dark.pdf` (с debounce) при каждом сохранении рисунка
- ❖ **Data scripts** — `migrate.mjs` обновляет устаревшие рисунки с hex/opacity до цветовых ролей; `fix-beziers.mjs` заменяет заглушки кривых на реальные элементы bezier

## ■ Стек

<div align="center">

| Компонент | Технология |
|-----------|------------|
| Editor | React 19, react-konva, Konva |
| Dev server / API | Vite 8 + custom plugin, chokidar |
| Export | Node.js ESM scripts (JSON → SVG) |
| Book | Typst (compiled to light/dark PDF) |

</div>

## ■ Как это работает

```
1. Рисуйте фигуры в canvas-редакторе; при каждом сохранении JSON рисунка отправляется в API плагина Vite
2. API записывает исходный .json и генерирует рядом .light.svg / .dark.svg
3. chokidar обнаруживает новые SVG, применяет debounce и запускает Typst для пересборки main.pdf + main-dark.pdf
4. Запустите generate-svgs.mjs для полной перегенерации всех SVG без dev-сервера
```

## ■ Скриншоты

<div align="center">

![Screenshot](screenshots/main.png)

*Canvas-редактор с инструментами рисования, цветовой палитрой и живым превью light/dark*

</div>

## ■ Использование

```bash
npm install
npm run dev              # редактор + save API + автосборка Typst
node generate-svgs.mjs   # пакетная перегенерация всех .light/.dark SVG
```

## ■ Лицензия

MIT © [pluttan](https://github.com/pluttan)
