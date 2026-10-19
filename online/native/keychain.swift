import Foundation
import Security
import CryptoKit

// The encryption key stays in this process and macOS Keychain, never in JS or logs.
func encryptionKey() throws -> SymmetricKey {
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "Bloodboard ChatGPT Plan Probe",
        kSecAttrAccount as String: "credential-encryption-v1"
    ]
    var lookup = query
    lookup[kSecReturnData as String] = true
    lookup[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(lookup as CFDictionary, &result)
    if status == errSecSuccess, let data = result as? Data, data.count == 32 {
        return SymmetricKey(data: data)
    }
    if status != errSecItemNotFound { throw NSError(domain: "Keychain", code: Int(status)) }
    var bytes = [UInt8](repeating: 0, count: 32)
    let randomStatus = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    guard randomStatus == errSecSuccess else { throw NSError(domain: "Random", code: Int(randomStatus)) }
    let data = Data(bytes)
    var addition = query
    addition[kSecValueData as String] = data
    addition[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    let addStatus = SecItemAdd(addition as CFDictionary, nil)
    if addStatus == errSecDuplicateItem { return try encryptionKey() }
    guard addStatus == errSecSuccess else { throw NSError(domain: "Keychain", code: Int(addStatus)) }
    return SymmetricKey(data: data)
}

do {
    let request = FileHandle.standardInput.readDataToEndOfFile()
    guard let value = try JSONSerialization.jsonObject(with: request) as? [String: String],
          let operation = value["operation"], let input = value["input"] else {
        throw NSError(domain: "Input", code: 1)
    }
    let key = try encryptionKey()
    let output: String
    switch operation {
    case "encrypt":
        let box = try AES.GCM.seal(Data(input.utf8), using: key)
        guard let combined = box.combined else { throw NSError(domain: "Encrypt", code: 1) }
        output = combined.base64EncodedString()
    case "decrypt":
        guard let data = Data(base64Encoded: input) else { throw NSError(domain: "Input", code: 2) }
        let plaintext = try AES.GCM.open(AES.GCM.SealedBox(combined: data), using: key)
        guard let text = String(data: plaintext, encoding: .utf8) else { throw NSError(domain: "Input", code: 3) }
        output = text
    default:
        throw NSError(domain: "Input", code: 4)
    }
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: ["output": output]))
} catch {
    // No request content, token, key, or plaintext is included in diagnostics.
    let error = error as NSError
    FileHandle.standardError.write(Data("Credential protection unavailable (\(error.domain):\(error.code)).\n".utf8))
    exit(1)
}
