//! Phase 5: local AI. Everything runs on this computer. Python (faster-whisper, sherpa-onnx) does
//! speech recognition and speaker detection; Rust does highlight scoring, caption files and the optional Ollama call.
pub mod ass;
pub mod audio;
pub mod env;
pub mod highlights;
pub mod ollama;
pub mod post;
pub mod reframe;
pub mod sounds;
pub mod transcript;
