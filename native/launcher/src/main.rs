#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
use std::ffi::{c_void, OsString};
use std::os::windows::{io::AsRawHandle, process::CommandExt};
use std::process::{Command, Stdio};

#[repr(C)]
#[derive(Default)]
struct BasicLimits {
    process_time: i64,
    job_time: i64,
    flags: u32,
    minimum: usize,
    maximum: usize,
    active: u32,
    affinity: usize,
    priority: u32,
    scheduling: u32,
}
#[repr(C)]
#[derive(Default)]
struct IoCounters {
    read_ops: u64,
    write_ops: u64,
    other_ops: u64,
    read_bytes: u64,
    write_bytes: u64,
    other_bytes: u64,
}
#[repr(C)]
#[derive(Default)]
struct Limits {
    basic: BasicLimits,
    io: IoCounters,
    process_memory: usize,
    job_memory: usize,
    process_peak: usize,
    job_peak: usize,
}
#[link(name = "kernel32")]
extern "system" {
    fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> *mut c_void;
    fn SetInformationJobObject(
        job: *mut c_void,
        class: i32,
        information: *const c_void,
        size: u32,
    ) -> i32;
    fn AssignProcessToJobObject(job: *mut c_void, process: *mut c_void) -> i32;
    fn CloseHandle(handle: *mut c_void) -> i32;
    fn GetStdHandle(which: u32) -> *mut c_void;
    fn AttachConsole(process: u32) -> i32;
}
#[link(name = "user32")]
extern "system" {
    fn MessageBoxW(window: *mut c_void, text: *const u16, caption: *const u16, kind: u32) -> i32;
}
struct Job(*mut c_void);
impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}
fn launch() -> Result<i32, Box<dyn std::error::Error>> {
    let executable = std::env::current_exe()?;
    let root = executable.parent().ok_or("Cannot locate RoGraph folder")?;
    let mut args: Vec<OsString> = std::env::args_os().skip(1).collect();
    let gui = args.is_empty();
    if gui {
        args = vec![
            "open".into(),
            "--workspace".into(),
            std::env::var_os("ROGRAPH_WORKSPACE")
                .unwrap_or_else(|| root.join("workspace").into_os_string()),
        ];
    } else {
        unsafe {
            let handle = GetStdHandle((-11_i32) as u32);
            if handle.is_null() || handle as usize == usize::MAX {
                AttachConsole(u32::MAX);
            }
        }
    }
    let runtime = root.join("runtime/node.exe");
    let app = root.join("dist/cli.js");
    if !runtime.is_file() || !app.is_file() {
        return Err(
            "The RoGraph folder is incomplete. Re-extract the full portable package.".into(),
        );
    }
    let mut limits = Limits::default();
    limits.basic.flags = 0x2000;
    let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    if handle.is_null() {
        return Err(std::io::Error::last_os_error().into());
    }
    let job = Job(handle);
    if unsafe {
        SetInformationJobObject(
            job.0,
            9,
            &limits as *const _ as *const c_void,
            std::mem::size_of::<Limits>() as u32,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().into());
    }
    let mut command = Command::new(runtime);
    command
        .arg(app)
        .args(args)
        .env("ROGRAPH_ROOT", root)
        .creation_flags(0x08000000);
    if gui {
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
    } else {
        command
            .stdin(Stdio::inherit())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit());
    }
    let mut child = command.spawn()?;
    if unsafe { AssignProcessToJobObject(job.0, child.as_raw_handle() as *mut c_void) } == 0 {
        let error = std::io::Error::last_os_error();
        let _ = child.kill();
        let _ = child.wait();
        return Err(error.into());
    }
    let status = child.wait()?;
    drop(job);
    Ok(status.code().unwrap_or(1))
}
fn main() {
    let gui = std::env::args_os().len() == 1;
    let status = match launch() {
        Ok(code) => code,
        Err(error) => {
            if gui {
                let text: Vec<u16> = format!("RoGraph could not start.\n\n{}", error)
                    .encode_utf16()
                    .chain(Some(0))
                    .collect();
                let title: Vec<u16> = "RoGraph".encode_utf16().chain(Some(0)).collect();
                unsafe {
                    MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), 0x10);
                }
            } else {
                eprintln!(
                    "{{\"error\":{{\"code\":\"LAUNCH_FAILED\",\"message\":{:?}}}}}",
                    error.to_string()
                );
            }
            1
        }
    };
    std::process::exit(status);
}
