//! Child processes (FFmpeg, yt-dlp, Python) must not outlive AutoKlipper, even if it crashes or is killed:
//! an orphaned live recorder would fill the disk. On Windows every child joins a job object that the
//! system tears down, with everything in it, when AutoKlipper's last handle to it closes.
use std::process::Child;

#[cfg(windows)]
pub fn bind_to_app(child: &Child) -> bool {
    use std::os::windows::io::AsRawHandle;
    use std::sync::OnceLock;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    // The handle is deliberately never closed: Windows closes it when the process ends.
    static JOB: OnceLock<usize> = OnceLock::new();
    let job = *JOB.get_or_init(|| unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return 0;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            (&raw const info).cast(),
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok == 0 { 0 } else { job as usize }
    });
    job != 0 && unsafe { AssignProcessToJobObject(job as _, child.as_raw_handle() as _) != 0 }
}

#[cfg(not(windows))]
pub fn bind_to_app(_child: &Child) -> bool {
    false
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn a_child_process_can_be_bound() {
        let mut c = std::process::Command::new("cmd").args(["/c", "ping -n 3 127.0.0.1 >nul"]).spawn().unwrap();
        assert!(bind_to_app(&c));
        let _ = c.kill();
        let _ = c.wait();
    }
}
