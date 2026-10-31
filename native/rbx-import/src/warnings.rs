use serde_json::{json, Value};
use std::sync::Mutex;
struct Capture;
static LOGGER: Capture = Capture;
static MESSAGES: Mutex<Vec<Value>> = Mutex::new(Vec::new());
impl log::Log for Capture {
    fn enabled(&self, _: &log::Metadata) -> bool {
        true
    }
    fn log(&self, r: &log::Record) {
        let message = r.args().to_string();
        if r.level() <= log::Level::Warn
            || (r.level() <= log::Level::Info && message.contains("Unknown binary chunk"))
        {
            MESSAGES
                .lock()
                .unwrap()
                .push(json!({"code":"DECODER_WARNING","severity":"warning","message":message}));
        }
    }
    fn flush(&self) {}
}
pub fn initialize() {
    let _ = log::set_logger(&LOGGER);
    log::set_max_level(log::LevelFilter::Info);
}
pub fn reset() {
    MESSAGES.lock().unwrap().clear();
}
pub fn take() -> Vec<Value> {
    std::mem::take(&mut *MESSAGES.lock().unwrap())
}
