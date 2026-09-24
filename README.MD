# Caption Studio

> A full-stack video captioning editor for creating, styling, previewing, and exporting burned-in captions for short-form and long-form videos.

Caption Studio is a web-based video captioning application built from the ground up with a focus on accurate word-level timing, flexible caption styling, synchronized preview, and reliable server-side video export.

It supports the complete workflow from uploading a video to downloading a final captioned MP4.

---

## ✨ Features

### 🎬 Video Upload & Processing

- Drag-and-drop video upload
- Supports common video formats including:
  - MP4
  - MOV
  - WebM
- Server-side video metadata inspection with FFprobe
- Video streaming with HTTP Range support
- File size and format validation
- Long-form video support
- Safe temporary-file handling

### 🎙️ Automatic Transcription

- Local transcription using [whisper.cpp](https://github.com/ggerganov/whisper.cpp)
- Word-level timestamps
- No external transcription API required
- Transcription runs locally on the application server
- Progress tracking
- Cancellation support
- Configurable Whisper binary and model paths

### 📝 Intelligent Caption Segmentation

Caption Studio does not simply display Whisper's raw 30-second segments.

The application converts Whisper's token-level output into word-level transcription data and then generates readable caption segments using a dedicated segmentation engine.

The segmentation system considers:

- Maximum word count
- Maximum character count
- Caption duration
- Natural pauses
- Sentence boundaries
- Punctuation
- Function-word boundaries
- Very short caption fragments

This allows long spoken passages to be broken into readable captions while preserving the original word timestamps.

### ✏️ Caption Editor

Edit captions directly after transcription.

Supported operations include:

- Edit caption text
- Adjust timing
- Split captions
- Merge captions
- Navigate between captions
- Immediately preview changes

Caption editing does not require retranscription.

### 🎨 Caption Styles

Caption Studio currently includes five built-in styles:

#### Classic

Clean, readable captions with configurable positioning and outline/shadow treatment.

#### Karaoke

Highlights the currently spoken word using the actual Whisper word timestamps.

#### Dynamic

Large, centered, emphasized captions with uppercase styling, word highlighting, and entrance animation.

#### Highlight

Emphasizes the final word of each caption segment.

#### Podcast

Captions displayed inside a semi-transparent background box.

---

## 👀 Synchronized Preview

The video preview uses the video's actual playback time as the source of truth.

Captions are synchronized against:

- Caption segment timestamps
- Word-level timestamps
- Current playback position

The preview supports:

- Play/pause
- Seeking
- Caption synchronization
- Word highlighting
- Caption positioning
- Style changes
- Fullscreen preview
- Real-time caption editing

The caption overlay does not maintain its own copy of the caption document, helping prevent synchronization bugs after editing.

---

## 📤 Video Export

Caption Studio can permanently burn captions into the original video.

The export pipeline is:

```text
Video
  ↓
CaptionDocument
  ↓
Caption Style
  ↓
ASS subtitle generation
  ↓
FFmpeg / libass
  ↓
Validated MP4
  ↓
Download
````

Exports use FFmpeg with ASS subtitles rendered through libass.

The final video uses:

* H.264 video
* AAC audio
* MP4 container

### Export features

* Real FFmpeg progress
* Export cancellation
* Output validation
* Temporary-file cleanup
* Safe download endpoint
* HTTP Range support
* Audio preservation
* Multiple aspect ratios
* All five caption styles

---

## 📐 Aspect Ratio Support

Caption positioning and layout are designed to work across different video dimensions.

Tested formats include:

| Format    | Example    |
| --------- | ---------- |
| Landscape | 1280 × 720 |
| Portrait  | 720 × 1280 |
| Square    | 720 × 720  |

Additional odd video dimensions are covered by automated tests.

---

## 🏗️ Architecture

Caption Studio is structured as a modular monolith.

The application separates:

```text
UI
 │
 ├── Video Player
 ├── Caption Editor
 ├── Style Controls
 └── Export Panel
        │
        ▼
Application Services
 │
 ├── Transcription
 ├── Video Processing
 ├── Caption Engine
 └── Export
        │
        ▼
Domain
 │
 ├── CaptionDocument
 ├── Caption Segmentation
 ├── Caption Lookup
 ├── Caption Styles
 └── Export Representation
        │
        ▼
Infrastructure
 │
 ├── FFmpeg
 ├── FFprobe
 ├── whisper.cpp
 └── Local Filesystem
```

### Core caption data flow

```text
Video
  ↓
whisper.cpp
  ↓
Word-level transcription
  ↓
Caption segmentation
  ↓
CaptionDocument
  ↓
Caption editing
  ↓
Caption style
  ├───────────────┐
  ↓               ↓
Browser Preview   Export
                  ↓
                FFmpeg
                  ↓
              Final MP4
```

The original word-level transcription data is preserved.

Whisper's original segment boundaries are **not** treated as the final displayed caption boundaries.

---

## 🧰 Tech Stack

### Frontend

* Next.js
* React
* TypeScript
* Tailwind CSS
* shadcn/ui
* Zustand

### Video Processing

* FFmpeg
* FFprobe
* libass
* FreeType
* H.264 / x264
* AAC

### Transcription

* whisper.cpp
* Local Whisper model

### Testing

* Vitest
* Browser-based end-to-end testing
* Real FFmpeg integration tests
* Real whisper.cpp integration tests

---

## 📁 Project Structure

```text
src/
├── app/
│   ├── api/
│   │   ├── export/
│   │   ├── transcribe/
│   │   ├── upload/
│   │   └── jobs/
│   └── ...
│
├── components/
│   ├── caption-overlay/
│   ├── editor/
│   ├── export/
│   ├── style/
│   └── video/
│
├── domain/
│   ├── caption-engine/
│   ├── export-engine/
│   └── style-engine/
│
├── features/
│   └── export/
│
├── services/
│   ├── export/
│   ├── transcription/
│   ├── video-processing/
│   └── storage/
│
├── stores/
│   ├── usePlaybackStore.ts
│   ├── useCaptionStore.ts
│   └── useExportStore.ts
│
└── ...
│
assets/
└── fonts/
```

---

## 🚀 Getting Started

### Prerequisites

Make sure you have:

* Node.js
* npm
* FFmpeg
* FFprobe
* whisper.cpp
* A compatible Whisper model

The application is designed around local video processing and local transcription.

---

### 1. Clone the repository

```bash
git clone <repository-url>
cd caption-studio
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure Whisper

Set the following environment variables:

```env
WHISPER_BINARY_PATH=/path/to/whisper-cli
WHISPER_MODEL_PATH=/path/to/model.bin
```

Use the actual binary and model paths on your machine.

### 4. Start the development server

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

---

## 🔐 Environment Variables

| Variable              | Description                        |
| --------------------- | ---------------------------------- |
| `WHISPER_BINARY_PATH` | Path to the whisper.cpp executable |
| `WHISPER_MODEL_PATH`  | Path to the Whisper model          |

The application does not require an external transcription API for its core workflow.

---

## 🧪 Testing

Run the test suite with:

```bash
npm test
```

Run the type checker:

```bash
npm run typecheck
```

Run linting:

```bash
npm run lint
```

Build the production application:

```bash
npm run build
```

### Current verification

The V1 implementation contains:

* **325 automated tests**
* **34 test files**
* Unit tests
* Integration tests
* Real FFmpeg tests
* Real whisper.cpp tests
* Browser E2E verification

The export system has also been tested with a real approximately 20-minute video.

---

## 📊 Long-Form Video

Long-form video is a core design requirement.

The application processes videos through files and FFmpeg rather than loading the entire video into application memory.

A real approximately 20-minute video was tested:

* Resolution: 1280 × 720
* 2,820 words
* 564 captions
* Real whisper.cpp transcription
* Karaoke export
* 76-second export time
* Correct output duration
* Frame verification at multiple points

A 2-hour / 2 GB export has **not** been fully tested yet.

---

## 🔒 Security Considerations

Caption Studio takes several precautions around video processing:

* UUID validation
* Safe filesystem path handling
* No client-supplied FFmpeg argument arrays
* FFmpeg executed using argument arrays
* No raw shell command construction from user input
* Request-body allowlisting
* Caption style validation
* Temporary export directory isolation
* Output validation before completion
* Path traversal protection
* Safe download handling

Video files are processed from disk rather than being loaded completely into application memory.

---

## 🎯 Preview vs Export

The browser preview and FFmpeg export share the same underlying caption data and timing model.

The export does not:

* retranscribe the video
* regenerate caption timing
* use raw Whisper segments
* estimate word timing from character counts
* redistribute word timing

Instead:

```text
CaptionDocument
      ↓
Shared caption/style logic
      ↓
 ┌───────────────┐
 │               │
 ▼               ▼
Browser        FFmpeg
Preview        Export
```

Some visual differences are unavoidable because the browser uses CSS while the export uses libass.

Known differences include:

* Square-cornered export boxes
* Different line spacing
* No shadow blur in export
* Dynamic active-word scale is not exported
* 80 ms colour transition is not exported
* Non-Inter fonts currently export using Inter

These are documented limitations of the current V1 implementation.

---

## ⚠️ Current Limitations

Caption Studio is a completed V1, but several limitations remain intentionally documented.

### Export

* 2-hour / 2 GB export has not been fully tested.
* Server restart during an active export loses that render.
* Completed exports currently do not have automatic retention/deletion.
* Non-square pixel aspect ratios are not tested.

### Style parity

Some Dynamic and Podcast layouts differ from the browser preview on portrait and square videos due to libass rendering behavior.

### Fonts

Inter Latin fonts are bundled.

Non-Latin glyph coverage has not yet been fully bundled.

### Animations

Some browser-only effects are not reproduced exactly during FFmpeg export.

---

## 🗺️ Future Ideas

Possible future improvements include:

* More caption presets
* Custom fonts
* Better multilingual font support
* More advanced animations
* Improved portrait/square export parity
* Automatic export cleanup
* Resumable exports
* More advanced export settings
* Subtitle file export such as SRT/VTT
* Cloud storage
* Authentication
* Collaboration
* Background job infrastructure

These are **future possibilities**, not requirements for the current V1.

---

## 🧠 Engineering Principles

Caption Studio was built around a few important principles:

### 1. Word timing is the source of truth

Whisper's word-level timing is preserved rather than replaced by estimated timing.

### 2. Transcription and caption layout are separate

Whisper determines what was said and when.

The caption engine determines how that information is presented.

### 3. Preview and export share domain data

The browser preview and FFmpeg exporter should not maintain independent caption models.

### 4. Long-form videos are a first-class requirement

The architecture avoids loading entire videos into application memory.

### 5. External infrastructure is introduced only when necessary

The V1 architecture intentionally avoids unnecessary queues, Redis, cloud storage, and microservices.

### 6. Validate before declaring success

Exports are not considered complete merely because FFmpeg exits successfully.

The generated file is validated before the job is marked completed.

---

## 📸 Screenshots

![Caption Studio Screenshot](./assets/Screenshot%202026-09-24%20170041.png)

* Main editor
* Caption editing
* Caption styles
* Karaoke preview
* Export panel
* Final exported video

---

---

## 🤝 Contributing

Contributions and ideas are welcome.

Before making significant changes, please read in the doc folder:

* `PROJECT.md`
* `ARCHITECTURE.md`
* `PRODUCT_REQUIREMENTS.md`
* `DEVELOPMENT_PLAN.md`
* `DESIGN_SYSTEM.md`
* `CLAUDE.md`

The project intentionally follows a modular architecture, so new functionality should fit into the existing domain/service boundaries rather than bypassing them.

---

## 📄 License

```text
MIT License
```

---

## 👨‍💻 Author

Built by **Ozioma Egole**.

A project focused on exploring the intersection of:

* Web development
* Product design
* Video technology
* AI-assisted development
* Developer tooling

---

## ⭐ Project Status

**Caption Studio V1 — Complete**

The current V1 supports the complete workflow:

```text
Upload
  ↓
Transcribe
  ↓
Segment
  ↓
Edit
  ↓
Style
  ↓
Preview
  ↓
Export
  ↓
Download
```

The project is considered feature-complete for its current V1 scope.

Future improvements can be developed independently without blocking the current release.

```