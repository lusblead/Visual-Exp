using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace VisualizedExp.Companion;

internal sealed class WindowsCredentialStore
{
    private const uint CredentialTypeGeneric = 1;
    private const uint CredentialPersistLocalMachine = 2;
    private const int ErrorNotFound = 1168;
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    private readonly string targetName;

    public WindowsCredentialStore(string targetName)
    {
        this.targetName = targetName;
    }

    public bool IsConfigured()
    {
        return TryRead(out _);
    }

    public string? Read()
    {
        return TryRead(out var credential) ? credential : null;
    }

    public void Write(string apiKey)
    {
        var targetPointer = IntPtr.Zero;
        var userPointer = IntPtr.Zero;
        var blobPointer = IntPtr.Zero;
        byte[]? blob = null;
        var blobLength = 0;

        try
        {
            targetPointer = Marshal.StringToCoTaskMemUni(targetName);
            userPointer = Marshal.StringToCoTaskMemUni("VisualizedExp");
            blob = StrictUtf8.GetBytes(apiKey);
            blobLength = blob.Length;
            blobPointer = Marshal.AllocCoTaskMem(blob.Length);
            Marshal.Copy(blob, 0, blobPointer, blob.Length);

            var credential = new NativeCredential
            {
                Type = CredentialTypeGeneric,
                TargetName = targetPointer,
                CredentialBlobSize = checked((uint)blob.Length),
                CredentialBlob = blobPointer,
                Persist = CredentialPersistLocalMachine,
                UserName = userPointer,
            };

            if (!CredWrite(ref credential, 0))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }
        }
        finally
        {
            if (blob is not null)
            {
                CryptographicOperations.ZeroMemory(blob);
            }

            if (blobPointer != IntPtr.Zero)
            {
                ZeroAndFree(blobPointer, blobLength);
            }

            if (targetPointer != IntPtr.Zero)
            {
                Marshal.FreeCoTaskMem(targetPointer);
            }

            if (userPointer != IntPtr.Zero)
            {
                Marshal.FreeCoTaskMem(userPointer);
            }
        }
    }

    public void Delete()
    {
        if (CredDelete(targetName, CredentialTypeGeneric, 0))
        {
            return;
        }

        var error = Marshal.GetLastWin32Error();
        if (error != ErrorNotFound)
        {
            throw new Win32Exception(error);
        }
    }

    private bool TryRead(out string? apiKey)
    {
        apiKey = null;
        if (!CredRead(targetName, CredentialTypeGeneric, 0, out var credentialPointer))
        {
            var error = Marshal.GetLastWin32Error();
            if (error == ErrorNotFound)
            {
                return false;
            }

            throw new Win32Exception(error);
        }

        try
        {
            var credential = Marshal.PtrToStructure<NativeCredential>(credentialPointer);
            if (credential.CredentialBlob == IntPtr.Zero || credential.CredentialBlobSize == 0)
            {
                return false;
            }

            var blob = new byte[checked((int)credential.CredentialBlobSize)];
            try
            {
                Marshal.Copy(credential.CredentialBlob, blob, 0, blob.Length);
                apiKey = StrictUtf8.GetString(blob);
                return true;
            }
            finally
            {
                CryptographicOperations.ZeroMemory(blob);
            }
        }
        finally
        {
            CredFree(credentialPointer);
        }
    }

    private static void ZeroAndFree(IntPtr pointer, int maximumBytes)
    {
        for (var index = 0; index < maximumBytes; index += 1)
        {
            Marshal.WriteByte(pointer, index, 0);
        }

        Marshal.FreeCoTaskMem(pointer);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeCredential
    {
        public uint Flags;
        public uint Type;
        public IntPtr TargetName;
        public IntPtr Comment;
        public NativeFileTime LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public IntPtr TargetAlias;
        public IntPtr UserName;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeFileTime
    {
        public uint LowDateTime;
        public uint HighDateTime;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CredWrite(ref NativeCredential credential, uint flags);

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CredRead(
        string target,
        uint type,
        uint reservedFlag,
        out IntPtr credentialPointer);

    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CredDelete(string target, uint type, uint flags);

    [DllImport("advapi32.dll")]
    private static extern void CredFree(IntPtr credentialPointer);
}
