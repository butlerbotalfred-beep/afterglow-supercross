import Foundation
import GameController

// This helper only runs while a local game tab requests controller input.
GCController.shouldMonitorBackgroundEvents = true
var indices: [ObjectIdentifier:Int] = [:]
var nextIndex = 1000
func button(_ input:GCControllerButtonInput?) -> [String:Any] {
    let value=input?.value ?? 0
    return ["value":value,"pressed":value > 0.5]
}
let timer=Timer.scheduledTimer(withTimeInterval:1.0/60.0,repeats:true){ _ in
    let controllers=GCController.controllers()
    let active=Set(controllers.map{ObjectIdentifier($0)})
    indices=indices.filter{active.contains($0.key)}
    let pads=controllers.compactMap { controller -> [String:Any]? in
        guard let g=controller.extendedGamepad else{return nil}
        let key=ObjectIdentifier(controller)
        if indices[key]==nil {indices[key]=nextIndex;nextIndex+=1}
        return ["index":indices[key]!,"id":(controller.vendorName ?? "Controller")+" / macOS","connected":true,
            "axes":[g.leftThumbstick.xAxis.value,-g.leftThumbstick.yAxis.value,g.rightThumbstick.xAxis.value,-g.rightThumbstick.yAxis.value],
            "buttons":[button(g.buttonA),button(g.buttonB),button(g.buttonX),button(g.buttonY),button(g.leftShoulder),button(g.rightShoulder),button(g.leftTrigger),button(g.rightTrigger),button(g.buttonOptions),button(g.buttonMenu),button(g.leftThumbstickButton),button(g.rightThumbstickButton),button(g.dpad.up),button(g.dpad.down),button(g.dpad.left),button(g.dpad.right)]]
    }
    if let data=try? JSONSerialization.data(withJSONObject:pads),let text=String(data:data,encoding:.utf8){print(text);fflush(stdout)}
}
RunLoop.main.run()
