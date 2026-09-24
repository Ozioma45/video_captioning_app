# Caption Studio — Project Specification

## 1. Project Overview

Caption Studio is a web-based video captioning and editing application that allows users to upload videos, automatically generate accurate captions/subtitles, customize the appearance and behavior of those captions, preview the result, and export a captioned video.

The application is designed to support **both short-form and long-form video content**.

Short-form examples:

- TikTok
- Instagram Reels
- YouTube Shorts
- Facebook Reels
- Short social media clips

Long-form examples:

- YouTube videos
- Podcasts
- Interviews
- Tutorials
- Lectures
- Courses
- Webinars
- Presentations
- Commentary videos
- Recorded meetings
- Documentaries
- Other long videos

The product should not be architected around a fixed short-video duration.

A 30-second video and a 2-hour video should both be valid inputs.

The goal is to create a polished, modern, free-first alternative to basic captioning tools, with a strong emphasis on:

1. Beautiful caption styles
2. Accurate caption timing
3. Word-level synchronization
4. Easy customization
5. Smooth video editing experience
6. Support for both short and long videos
7. Local/free processing wherever practical
8. A foundation that can eventually become a SaaS product

---

# 2. Product Vision

The long-term vision is to build a powerful browser-based video caption editor where a user can:

> Upload a video → automatically transcribe it → edit the transcript → choose a caption style → customize the captions → preview the result → export the finished video.

The application should eventually feel closer to a lightweight combination of:

- Caption editor
- Subtitle editor
- Video editor
- Social-media caption generator

rather than simply being a tool that places static subtitles on a video.

The product should prioritize simplicity.

A first-time user should be able to understand the main workflow without needing technical knowledge.

---

# 3. Core Product Philosophy

## 3.1 Free-first

The first version should be designed so that development and initial testing can be performed with little or no paid infrastructure.

Prefer:

- Open-source technologies
- Local processing
- Browser-side processing where practical
- Self-hostable components
- Free tiers during development
- Provider-agnostic architecture

Do NOT unnecessarily introduce paid APIs when an open-source/local alternative is practical.

However, architecture should remain flexible enough to support paid cloud services later.

---

## 3.2 Short and long videos are first-class citizens

Do not assume that every video is:

- vertical
- under 60 seconds
- intended for TikTok
- intended for Reels
- intended for Shorts

The system must treat video duration as variable.

Examples of valid videos:

```text
15 seconds
45 seconds
90 seconds
5 minutes
15 minutes
30 minutes
1 hour
2 hours
```

The architecture should avoid arbitrary hard-coded duration restrictions.

Where processing limitations exist, they should be clearly defined and configurable.

---

## 3.3 Caption quality matters more than the number of features

A smaller number of polished caption styles is preferable to dozens of poorly implemented styles.

V1 should prioritize:

- accurate timing
- good typography
- clean animations
- reliable rendering
- good preview experience
- consistent exports

rather than trying to replicate every feature of large video-editing applications.

---

# 4. Target Users

The initial target users include:

### Content creators

People creating:

- YouTube videos
- Shorts
- TikToks
- Reels
- Educational content
- Talking-head videos

### Podcasters

People publishing:

- Video podcasts
- Interviews
- Conversations
- Podcast clips

### Educators

People creating:

- Tutorials
- Online courses
- Lectures
- Training videos

### Businesses

People creating:

- Product videos
- Marketing videos
- Social media content
- Training materials

### General users

Anyone who wants to add attractive captions/subtitles to a video.

---

# 5. Primary User Flow

The core workflow should be:

```text
1. Open Caption Studio
        ↓
2. Upload video
        ↓
3. Process video
        ↓
4. Generate transcript
        ↓
5. Generate caption timing
        ↓
6. Open editor
        ↓
7. Preview video + captions
        ↓
8. Edit transcript/timing if necessary
        ↓
9. Select caption style
        ↓
10. Customize style
        ↓
11. Preview changes
        ↓
12. Export
        ↓
13. Download finished video
```

This is the primary experience.

Everything else should support this flow.

---

# 6. V1 Scope

V1 should include the following core features.

## 6.1 Video Upload

Users should be able to upload a video from their device.

The system should:

- Accept common video formats
- Validate the file
- Read video metadata
- Determine duration
- Determine dimensions
- Determine aspect ratio
- Determine frame rate where available
- Display upload/process progress
- Handle invalid files gracefully

Potential formats:

```text
MP4
MOV
WebM
MKV
AVI
```

Actual supported formats should depend on the chosen processing implementation.

Do not claim support for a format unless the processing pipeline actually supports it.

---

# 7. Video Metadata

After upload, extract useful metadata:

```text
filename
file size
duration
width
height
aspect ratio
frame rate
video codec
audio presence
audio codec
```

This information may be used internally by the processing pipeline and editor.

---

# 8. Video Preview

The application must provide a video preview player.

The player should support:

- Play
- Pause
- Seek
- Current time
- Total duration
- Volume
- Mute
- Fullscreen where practical
- Timeline seeking

The caption preview should be synchronized with the video.

---

# 9. Caption Generation

The system should automatically generate captions from the video's audio.

The initial implementation should favor a free/open-source speech-to-text solution.

A local Whisper-based implementation is preferred for development where practical.

The architecture should allow future providers such as:

- OpenAI Whisper API
- Deepgram
- AssemblyAI
- Google Speech-to-Text
- Other speech-to-text providers

without requiring the entire application to be rewritten.

The speech-to-text layer should therefore be abstracted behind a service/interface.

Example conceptual interface:

```ts
interface TranscriptionProvider {
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}
```

---

# 10. Word-Level Timestamps

Word-level timestamps are a critical feature.

The transcription system should preserve individual word timing whenever possible.

Example:

```json
{
  "text": "Welcome to my channel",
  "words": [
    {
      "text": "Welcome",
      "start": 0.2,
      "end": 0.75
    },
    {
      "text": "to",
      "start": 0.76,
      "end": 0.9
    },
    {
      "text": "my",
      "start": 0.91,
      "end": 1.05
    },
    {
      "text": "channel",
      "start": 1.06,
      "end": 1.55
    }
  ]
}
```

Word-level timing enables:

- Karaoke captions
- Word highlighting
- Dynamic captions
- Word animations
- Emphasis
- Accurate caption transitions

Do not throw away word-level timestamps after transcription.

---

# 11. Caption Data Model

The internal caption representation should be independent from the transcription provider.

A conceptual model:

```ts
type CaptionWord = {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
};

type CaptionSegment = {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  words: CaptionWord[];
};

type CaptionDocument = {
  id: string;
  language: string;
  segments: CaptionSegment[];
};
```

The final implementation may differ, but the architecture should preserve this information.

---

# 12. Caption Segmentation

Raw transcription should not automatically determine the final visual caption layout.

The application should have a caption segmentation layer.

For example:

Raw transcript:

```text
Welcome to my channel today I am going to show you how I built this application
```

Visual captions might become:

```text
Welcome to my channel

Today I'm going to show you

how I built this application
```

The segmentation engine should eventually support configurable rules such as:

- Maximum words per caption
- Maximum characters per line
- Maximum lines
- Minimum caption duration
- Maximum caption duration
- Natural sentence boundaries
- Punctuation
- Word timing

These rules should be configurable rather than hard-coded into the UI.

## Source transcription data vs. final captions

- The **source transcription data** is the word-level timing derived from Whisper's words/tokens (`CaptionDocument.originalWords`). It is preserved and is never altered by segmentation or editing.
- Whisper's own **segment boundaries are not the final caption boundaries.** They are transcription structure only (whisper.cpp can return whole sentences or 30-second windows) and must not be displayed directly as captions.
- The final `CaptionDocument.segments` are produced by the application's **caption segmentation engine** from the word-level data.
- Segmentation **does not change word timestamps**. Each caption keeps its assigned words with their original timing, and the caption's own start and end come from those words.
- The caption segmentation layer alone determines the displayed caption boundaries.

---

# 13. Caption Editing

Users must be able to edit generated captions.

At minimum:

- Edit caption text
- Split caption
- Merge caption
- Change timing
- Delete caption
- Add caption

The editor should eventually allow:

- Word-level editing
- Adjusting individual word timing
- Caption duration adjustment

Do not make the user regenerate the entire transcript simply because one caption needs correction.

---

# 14. Caption Timeline

The application should have a caption timeline/editor.

The timeline should eventually show:

```text
Video timeline
──────────────────────────────────────

Caption 1     ███████
Caption 2            █████████
Caption 3                       ███████
Caption 4                              █████████
```

The user should be able to understand:

- When captions appear
- When captions disappear
- Where the current playback position is
- Which caption is currently active

The current active caption should be visually identifiable.

---

# 15. Caption Styles

Caption Studio should have a reusable caption-style system.

Do not hard-code styles directly into individual components.

A style should be represented as configuration.

Conceptually:

```ts
type CaptionStyle = {
  id: string;
  name: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  textColor: string;
  highlightColor?: string;
  backgroundColor?: string;
  stroke?: StrokeConfig;
  shadow?: ShadowConfig;
  position: PositionConfig;
  animation?: AnimationConfig;
  alignment: Alignment;
  maxLines: number;
};
```

The actual implementation can evolve.

---

# 16. Initial Caption Styles

V1 should contain approximately 5 polished styles.

Do not build dozens initially.

Suggested styles:

## Style 1 — Classic

Characteristics:

- White text
- Dark outline/shadow
- Clean typography
- Centered
- Suitable for general videos

Useful for:

- YouTube
- Tutorials
- Interviews
- Long-form videos

---

## Style 2 — Karaoke

Characteristics:

- Normal words remain visible
- Currently spoken word becomes highlighted
- Word-level synchronization
- Smooth highlighting

Example:

```text
What's UP everyone
       ↑
   highlighted
```

---

## Style 3 — Dynamic

Characteristics:

- Large text
- Word-by-word appearance
- Strong visual movement
- Designed for short-form content

However, the style must still work on longer videos.

---

## Style 4 — Highlight

Characteristics:

- Normal text
- Important words highlighted
- Strong contrast
- Minimal animation

Useful for:

- Tutorials
- Educational videos
- Commentary
- Business videos

---

## Style 5 — Podcast

Characteristics:

- Clean typography
- Large readable text
- Optional background
- Professional appearance
- Minimal distracting animation

Suitable for:

- Podcasts
- Interviews
- Long-form YouTube videos

---

# 17. Caption Style Engine

The style system must be reusable.

Conceptually:

```text
Caption
    ↓
Style Engine
    ↓
Visual Caption
```

The same caption data should be able to render using different styles.

For example:

```text
Caption Data
      │
      ├── Classic
      ├── Karaoke
      ├── Dynamic
      ├── Highlight
      └── Podcast
```

Changing styles should not modify the underlying transcript.

---

# 18. Caption Customization

Users should eventually be able to customize:

### Typography

- Font family
- Font size
- Font weight
- Letter spacing
- Line height

### Colors

- Text color
- Highlight color
- Background color
- Outline color

### Position

- Top
- Center
- Bottom
- Custom vertical position

### Appearance

- Stroke
- Shadow
- Background
- Rounded background
- Opacity

### Layout

- Words per line
- Maximum lines
- Alignment

### Animation

- Fade
- Pop
- Slide
- Word highlight
- Scale
- None

Customization should build on top of preset styles.

---

# 19. Preview System

The preview is extremely important.

Users should see the caption style applied to the video before exporting.

The preview should aim to match the final rendering as closely as possible.

Avoid creating a preview system that looks completely different from the exported result.

The architecture should separate:

```text
Caption Data
      ↓
Style Configuration
      ↓
Preview Renderer
      ↓
Export Renderer
```

Both renderers should use the same underlying caption/style definitions where practical.

---

# 20. Video Aspect Ratios

The application should support multiple aspect ratios.

At minimum:

```text
16:9  — YouTube / landscape
9:16  — Shorts / Reels / TikTok
1:1   — Square
```

The original video's aspect ratio should be preserved by default.

Users may later be able to change the output canvas.

Do not assume every video should be converted to 9:16.

---

# 21. Long-Form Video Requirements

Long videos are a core part of the product.

The application should be designed with long videos in mind from the beginning.

Potential challenges include:

- Large file sizes
- Long transcription times
- High memory usage
- Long rendering times
- Browser limitations
- Storage limitations
- Processing failures
- Network interruptions

The architecture should therefore avoid loading an entire large video into memory unnecessarily.

Where possible:

- Stream data
- Process in chunks
- Use temporary files
- Process audio separately
- Use background jobs for long operations
- Provide progress feedback

Do not optimize exclusively for 30-second videos.

---

# 22. Processing Architecture

The processing architecture should be modular.

Conceptually:

```text
                    ┌──────────────────┐
                    │   Web Interface  │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │  Project Manager │
                    └────────┬─────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
      ┌───────────────┐             ┌────────────────┐
      │ Transcription │             │ Video Processor│
      │    Service    │             │    Service     │
      └───────┬───────┘             └───────┬────────┘
              │                             │
              ▼                             ▼
      Caption Document                Rendered Video
              │
              ▼
       Caption Engine
              │
              ▼
       Style Renderer
```

---

# 23. FFmpeg

FFmpeg should be considered the primary video-processing engine for the initial implementation.

Potential responsibilities:

- Extract audio
- Read metadata
- Convert video
- Render captions
- Burn captions into video
- Encode output
- Generate thumbnails
- Handle supported format conversions

FFmpeg commands should not be scattered throughout UI components.

Create a dedicated processing layer.

---

# 24. Rendering Strategy

The final captioned video should be rendered using a reliable video-processing pipeline.

Potential approaches include:

- FFmpeg drawtext
- ASS subtitle rendering
- Generated subtitle files
- FFmpeg filter graphs
- Other suitable rendering mechanisms

For advanced animated captions, investigate ASS subtitle capabilities and/or generated FFmpeg filter expressions.

The implementation should prioritize:

1. Correct timing
2. Visual consistency
3. Rendering reliability
4. Performance

---

# 25. Export

The user should be able to export the final video.

At minimum:

```text
Export
   ↓
Process video
   ↓
Render captions
   ↓
Generate MP4
   ↓
Download
```

The application should display:

- Rendering state
- Progress where possible
- Success state
- Error state

The user should never be left wondering whether the application is still processing.

---

# 26. Export Quality

The system should avoid unnecessarily reducing video quality.

Where possible:

- Preserve resolution
- Preserve frame rate
- Preserve aspect ratio
- Use reasonable bitrate/CRF settings
- Preserve audio quality

The final encoding settings should be configurable internally.

Do not optimize purely for the smallest file size.

---

# 27. Project System

Eventually, users should be able to have multiple projects.

A project conceptually contains:

```text
Project
 ├── Video
 ├── Transcript
 ├── Caption configuration
 ├── Style
 ├── Export settings
 └── Metadata
```

Example:

```text
"My YouTube Podcast"
"My React Tutorial"
"Instagram Reel"
"Course Episode 01"
```

V1 may initially use a temporary/local project model, but the architecture should not prevent persistent projects later.

---

# 28. Storage

During development, local storage or temporary filesystem storage may be used where practical.

A future cloud architecture may use:

- Supabase Storage
- S3-compatible storage
- Cloudflare R2
- Other object storage

Do not tightly couple the application to a single storage provider.

---

# 29. Database

A database is not required for the earliest prototype if everything is temporary/local.

However, the architecture should allow a future database.

Potential entities:

```text
User
Project
Video
Transcript
CaptionSegment
CaptionWord
CaptionStyle
Export
```

Do not build a complex authentication/database system before the core editor works.

---

# 30. Authentication

Authentication is NOT a core requirement for the first functional prototype.

The first goal is to prove:

```text
Upload
→ Transcribe
→ Caption
→ Style
→ Preview
→ Export
```

Authentication can be introduced later.

---

# 31. User Interface

The UI should be modern and professional.

The design should feel like a real creative tool rather than a generic dashboard.

Potential structure:

```text
┌─────────────────────────────────────────────┐
│ Caption Studio                    Export     │
├─────────────────────────────────────────────┤
│                                             │
│              VIDEO PREVIEW                  │
│                                             │
│          [ caption appears here ]           │
│                                             │
├─────────────────────────────────────────────┤
│ Timeline                                    │
│ ─────────────────────────────────────────── │
├─────────────────────────────────────────────┤
│ Caption │ Style │ Text │ Timing │ Settings  │
└─────────────────────────────────────────────┘
```

The exact UI should be determined during the design phase.

Do not implement this exact layout without evaluating usability.

---

# 32. Editor UX

The editor should make the following relationship obvious:

```text
Video
+
Caption timeline
+
Caption settings
=
Final video
```

The user should be able to quickly switch between:

- Transcript editing
- Caption styling
- Video preview
- Export

Avoid overwhelming the user with every setting simultaneously.

Advanced settings can be progressively disclosed.

---

# 33. Responsive Design

The application should be responsive.

However, the primary editor experience should be optimized for desktop initially because video editing requires significant screen space.

Mobile support can initially focus on:

- Landing page
- Upload
- Project browsing
- Basic preview

A full professional video editor on mobile is not required for V1.

---

# 34. Accessibility

The application should consider:

- Keyboard navigation
- Readable contrast
- Accessible controls
- Focus states
- Clear error messages
- Non-color-only indicators

Caption previews should also prioritize readability.

---

# 35. Performance

Performance is important, especially for long videos.

The application should avoid unnecessary:

- Re-renders
- Video decoding
- Memory duplication
- Large React state objects
- Reprocessing
- Network transfers

Caption data should be efficiently represented.

Do not store huge video blobs inside React state.

---

# 36. State Management

The editor will likely require centralized state.

Potential state:

```text
Current project
Video metadata
Playback state
Current time
Transcript
Caption segments
Selected caption
Selected style
Style configuration
Export settings
Processing state
```

The implementation can choose an appropriate state-management solution.

The architecture should keep editor state separate from server/database state.

---

# 37. Error Handling

Every major processing step must have meaningful error handling.

Examples:

```text
Invalid video
Unsupported format
Video has no audio
Transcription failed
Caption generation failed
Rendering failed
Export failed
Storage failed
Processing timeout
```

Messages should explain:

1. What happened
2. Whether the user's project is safe
3. What they can do next

Avoid technical error messages such as:

```text
FFmpeg exited with code 1
```

as the only user-facing message.

---

# 38. Processing Progress

Long operations should provide progress information.

For example:

```text
Uploading video       ██████████ 100%

Extracting audio      ███████░░░ 70%

Transcribing          █████░░░░░ 50%

Preparing captions    ██████████ 100%

Rendering video       ████░░░░░░ 40%
```

Exact progress may not always be available.

When exact progress is impossible, use honest stage-based progress instead of fake percentages.

---

# 39. Long Video Processing

Long-form videos may require asynchronous/background processing.

The architecture should support jobs such as:

```text
TranscriptionJob
RenderingJob
ExportJob
```

A future implementation may use:

- Job queues
- Workers
- Redis
- Background processes

Do not introduce Redis or a complex queue unless the current implementation actually requires it.

Start simple.

---

# 40. Security

Uploaded videos are user-controlled files.

The system should consider:

- File type validation
- File size limits
- Filename sanitization
- Temporary file cleanup
- Process isolation
- Safe FFmpeg argument handling
- Prevention of command injection
- Storage access control

Never concatenate untrusted user input directly into shell commands.

Use safe process execution APIs.

---

# 41. Privacy

Videos may contain private conversations or sensitive information.

The product should minimize unnecessary data retention.

Temporary processing files should be deleted when no longer required.

If cloud processing is introduced later, privacy implications must be clearly documented.

The architecture should make it possible to offer local processing where practical.

---

# 42. Free Development Requirements

The initial project should aim to work without paid services.

Preferred development setup:

```text
Next.js
TypeScript
Tailwind CSS
shadcn/ui
FFmpeg
Whisper/local speech-to-text
Local filesystem
Git
GitHub
```

Optional free services:

```text
Supabase
Vercel
Cloudflare
```

Do not introduce a paid API solely because it is easier.

However, create provider abstractions so paid providers can be added later.

---

# 43. Technology Philosophy

Prefer boring, reliable technology over unnecessary complexity.

Do not introduce:

- Microservices
- Kubernetes
- Complex event systems
- Multiple databases
- Redis
- Message brokers

unless there is a concrete requirement.

The first version should preferably be a modular monolith.

---

# 44. Suggested Initial Technology Stack

The initial stack may be:

### Frontend

```text
Next.js
TypeScript
React
Tailwind CSS
shadcn/ui
```

### Video

```text
HTML5 Video
FFmpeg
```

### Speech-to-text

```text
Whisper
```

or another free/open-source implementation where appropriate.

### State

Use a lightweight state management solution appropriate for the editor.

### Backend

Next.js server-side functionality or a small dedicated processing server depending on FFmpeg/runtime requirements.

### Database

No database initially unless required.

Supabase may be introduced later.

### Deployment

Vercel can be used for frontend/application components that are compatible with its runtime.

Video processing may eventually require a separate worker/server because serverless environments are not necessarily suitable for heavy FFmpeg workloads.

---

# 45. Important Deployment Constraint

Do not assume that Vercel serverless functions are suitable for unlimited long-form video processing.

Long videos can involve:

- Large files
- Long-running FFmpeg processes
- High CPU usage
- High memory usage
- Long execution times

The production architecture may eventually require a dedicated processing worker/server.

For development, local FFmpeg processing is acceptable and preferred.

---

# 46. Future Provider Abstraction

The system should allow services to be swapped.

For example:

```text
TranscriptionProvider
 ├── LocalWhisperProvider
 ├── OpenAIProvider
 ├── DeepgramProvider
 └── AssemblyAIProvider
```

Similarly:

```text
StorageProvider
 ├── LocalStorage
 ├── SupabaseStorage
 ├── S3Storage
 └── R2Storage
```

And potentially:

```text
VideoProcessingProvider
 ├── LocalFFmpeg
 └── CloudVideoProcessor
```

Do not implement all providers now.

Create clean boundaries where they matter.

---

# 47. V1 Non-Goals

The following should NOT be built initially unless explicitly requested.

### Do not build:

- Full video editing suite
- Multi-track video editing
- Complex transitions
- Advanced color grading
- AI video generation
- AI avatar generation
- Background removal
- Automatic B-roll
- Music generation
- Full social media publishing
- Team collaboration
- Complex billing
- Enterprise accounts
- Mobile apps
- Desktop apps
- Complex authentication
- Complex analytics

The product is primarily a **caption generation, styling, editing, and rendering tool**.

---

# 48. Future Features

Potential future capabilities include:

## AI

- Automatic punctuation
- Filler-word removal
- Smart caption segmentation
- Important-word detection
- Emoji suggestions
- Translation
- Multilingual subtitles
- AI title generation
- AI description generation

## Video

- Trim video
- Crop video
- Resize
- Backgrounds
- Progress bars
- Watermarks
- Logo overlays

## Captions

- More styles
- Custom animations
- Custom templates
- Custom fonts
- Brand kits
- Speaker identification
- Multiple speakers

## Long-form

- Chapter detection
- Search transcript
- Jump to spoken word
- Transcript navigation
- Automatic chapters
- Highlight extraction

## Social content

- Automatically create clips
- Generate multiple short clips from long videos
- Different caption styles per platform
- Platform-specific aspect ratios

---

# 49. Potential Long-Term Product

The eventual product could evolve into:

```text
                Caption Studio
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
    Captions        Video Editor    AI Tools
        │              │              │
        ▼              ▼              ▼
   Subtitles        Resize         Transcript
   Karaoke          Crop           Cleanup
   Animation        Trim           Translation
   Templates        Effects        Highlights
```

But this is the long-term direction, not V1.

---

# 50. Development Principles for Claude Code

Claude Code must follow these rules while working on the project.

## Rule 1 — Understand before coding

Before implementing a major feature, understand:

- Why it exists
- How it interacts with the rest of the application
- Whether it belongs in V1
- What architectural consequences it creates

Do not blindly start coding from a feature request.

---

## Rule 2 — Do not over-engineer

Prefer:

```text
Simple + modular + replaceable
```

over:

```text
Complex + distributed + premature
```

---

## Rule 3 — Preserve extensibility

The application should be easy to extend.

Especially:

- Caption styles
- Transcription providers
- Storage providers
- Video processors
- Export formats

---

## Rule 4 — Do not duplicate logic

Caption timing, style definitions, validation, video metadata, and processing logic should have clear sources of truth.

---

## Rule 5 — Do not hard-code short-video assumptions

Never assume:

```text
duration < 60 seconds
aspect ratio = 9:16
captions = 2 lines
video = social media
```

unless a specific feature explicitly requires it.

---

## Rule 6 — Do not fake functionality

If something is not implemented, do not create a UI that pretends it works.

Use:

- TODO
- disabled state
- clear placeholder

rather than fake processing.

---

## Rule 7 — Test real video files

Do not rely only on mocked video data.

The project should eventually be tested against:

- Short video
- Long video
- Landscape video
- Vertical video
- Video without captions
- Video with poor audio
- Video with multiple speakers
- Large video

---

## Rule 8 — Protect the user's project

Processing failures should not destroy the transcript or editor state.

Separate source video, transcript, style configuration, and export output conceptually.

---

# 51. Development Order

The project should be built in this general sequence.

## Phase 0 — Understanding

Before coding:

1. Read this PROJECT.md
2. Analyze the requirements
3. Identify technical risks
4. Identify assumptions
5. Propose architecture
6. Identify unresolved decisions
7. Create architecture documentation

Do not start implementing the application yet.

---

## Phase 1 — Foundation

Build:

- Next.js application
- TypeScript
- Styling system
- UI foundation
- Folder structure
- State architecture
- Basic project structure

---

## Phase 2 — Video Input

Build:

- Upload
- Validation
- Metadata extraction
- Video preview
- Playback controls

---

## Phase 3 — Transcription

Build:

- Audio extraction
- Whisper integration
- Transcription service
- Word-level timestamps
- Caption document generation

---

## Phase 4 — Caption Editor

Build:

- Transcript view
- Caption segments
- Editing
- Timing
- Timeline
- Active-caption synchronization

---

## Phase 5 — Caption Styles

Build:

- Style architecture
- 5 initial styles
- Style switching
- Customization
- Word highlighting
- Basic animation

---

## Phase 6 — Preview

Build:

- Real-time caption preview
- Style preview
- Video synchronization
- Timeline synchronization

---

## Phase 7 — Export

Build:

- FFmpeg rendering
- Caption burning
- MP4 export
- Progress
- Error handling
- Download

---

## Phase 8 — Long-Video Optimization

Test and improve:

- Large files
- Long transcription
- Long rendering
- Memory usage
- Processing reliability
- Temporary-file management

---

## Phase 9 — Polish

Improve:

- UI
- UX
- Loading states
- Empty states
- Error states
- Accessibility
- Responsiveness
- Performance

---

# 52. Definition of Done for V1

V1 should be considered successful when a user can:

1. Open the application
2. Upload a real video
3. Process the video
4. Generate a transcript
5. Generate timed captions
6. Edit caption text
7. Choose between at least 5 caption styles
8. Customize caption appearance
9. Preview the captions synchronized with the video
10. Export a captioned MP4
11. Download the result

The workflow must work with both:

```text
Short videos
```

and

```text
Long videos
```

within the practical limits of the development environment.

---

# 53. Success Criteria

The first version should not be judged by how many features it has.

It should be judged by:

### Accuracy

Captions are properly synchronized.

### Quality

Caption styles look professional.

### Usability

A user can understand the editor quickly.

### Reliability

Exported videos actually work.

### Performance

The application remains usable with realistic video sizes.

### Extensibility

Adding a new caption style should not require rewriting the editor.

### Cost

The initial development workflow should remain free or close to free.

---

# 54. Final Instruction to Claude Code

You are working on Caption Studio.

This PROJECT.md is the high-level product specification.

Do not immediately start building the entire application.

First:

1. Read this document carefully.
2. Analyze the requirements.
3. Identify architectural risks.
4. Identify contradictions or unclear requirements.
5. Identify what must run locally versus in the browser/server.
6. Analyze the implications of supporting both short-form and long-form video.
7. Analyze FFmpeg requirements.
8. Analyze Whisper/transcription requirements.
9. Propose the application architecture.
10. Propose the folder structure.
11. Propose the data models.
12. Propose the caption rendering architecture.
13. Propose the processing pipeline.
14. Identify technologies that should be added or removed from the suggested stack.
15. Identify what should be implemented in V1 versus later.
16. Document your recommendations.

Create or propose:

```text
ARCHITECTURE.md
PRODUCT_REQUIREMENTS.md
DEVELOPMENT_PLAN.md
DESIGN_SYSTEM.md
CLAUDE.md
```

Do not begin implementing major application features until the architecture and development plan have been reviewed.

When implementation begins, work incrementally.

Build one logical subsystem at a time.

After each major subsystem:

- Run tests
- Verify the implementation
- Check for regressions
- Explain what changed
- Explain what remains
- Do not silently implement unrelated features

The ultimate goal is not merely to create a demo.

The goal is to create a technically sound foundation for a real caption-editing product that can eventually support both individual users and a larger SaaS user base.
