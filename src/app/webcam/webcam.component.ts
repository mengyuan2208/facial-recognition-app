import {
  Component,
  OnInit,
  Output,
  EventEmitter,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { Subject } from 'rxjs';
import { Observable } from 'rxjs';
import { WebcamImage, WebcamInitError, WebcamUtil } from 'ngx-webcam';
import * as faceapi from 'face-api.js';

@Component({
  selector: 'app-webcam',
  templateUrl: './webcam.component.html',
  styleUrls: ['./webcam.component.css'],
})
export class WebcamComponent implements OnInit {
  @ViewChild('overlay') overlayCanvas!: ElementRef<HTMLCanvasElement>;

  // toggle webcam on/off
  public showWebcam = true;
  public webcamImage: WebcamImage | undefined;
  public allowCameraSwitch = true;
  public multipleWebcamsAvailable = false;
  public deviceId: string = '';
  public videoOptions: MediaTrackConstraints = {
    // width: {ideal: 1024},
    // height: {ideal: 576}
  };
  public errors: WebcamInitError[] = [];

  // webcam snapshot trigger
  private trigger: Subject<void> = new Subject<void>();
  // switch to next / previous / specific webcam; true/false: forward/backwards, string: deviceId
  private nextWebcam: Subject<boolean | string> = new Subject<
    boolean | string
  >();
  public uploadedImageDataUrl: string | undefined;
  public isAnalyzing: boolean = false;

  async ngOnInit() {
    this.loadModels();
    WebcamUtil.getAvailableVideoInputs().then(
      (mediaDevices: MediaDeviceInfo[]) => {
        this.multipleWebcamsAvailable = mediaDevices && mediaDevices.length > 1;
      }
    );
  }

  async loadModels() {
    try {
      // await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
      await faceapi.nets.ssdMobilenetv1.loadFromUri('/assets/models');
      await faceapi.nets.faceLandmark68Net.loadFromUri('/assets/models');
      await faceapi.nets.faceRecognitionNet.loadFromUri('/assets/models');
      await faceapi.nets.ageGenderNet.loadFromUri('/assets/models');
      console.log('Face-api models loaded successfully.');
    } catch (error) {
      console.error('Model loading failed:', error);
    }
  }

  public triggerSnapshot(): void {
    this.trigger.next();
  }

  public toggleWebcam(): void {
    this.showWebcam = !this.showWebcam;
  }

  public handleInitError(error: WebcamInitError): void {
    this.errors.push(error);
  }

  public showNextWebcam(directionOrDeviceId: boolean | string): void {
    // true => move forward through devices
    // false => move backwards through devices
    // string => move to device with given deviceId
    this.nextWebcam.next(directionOrDeviceId);
  }

  public async handleImage(webcamImage: WebcamImage): Promise<void> {
    this.uploadedImageDataUrl = undefined;
    this.webcamImage = webcamImage;
    this.isAnalyzing = true;
    console.info('received webcam image', webcamImage);
    // Convert the WebcamImage to HTMLImageElement for face-api.js
    const image = await this.createImageFromWebcamImage(webcamImage);
    // this.overlayCanvas.nativeElement.width = image.width;
    // this.overlayCanvas.nativeElement.height = image.height;
    this.overlayCanvas.nativeElement.height = 300;
    // Perform face detection
    const detections = await faceapi
      .detectAllFaces(image, new faceapi.SsdMobilenetv1Options())
      .withFaceLandmarks()
      .withFaceDescriptors()
      .withAgeAndGender();
    console.log(detections);
    this.isAnalyzing = false;
    this.drawDetections(detections);
  }

  private drawDetections(detections: any) {
    const ctx = this.overlayCanvas.nativeElement.getContext('2d');
    if (ctx) {
      ctx.clearRect(
        0,
        0,
        this.overlayCanvas.nativeElement.width,
        this.overlayCanvas.nativeElement.height
      );

      // Resize the detections to match the display size
      const resizedDetections = faceapi.resizeResults(detections, {
        width: this.overlayCanvas.nativeElement.width,
        height: this.overlayCanvas.nativeElement.height,
      });

      // Extract just the detection objects for drawing
      const detectionsForDrawing = resizedDetections.map(
        (det: any) => det.detection
      );

      // Now, draw just the detections
      faceapi.draw.drawDetections(
        this.overlayCanvas.nativeElement,
        detectionsForDrawing
      );

      // Optionally draw face landmarks and face expressions if needed
      // faceapi.draw.drawFaceLandmarks(
      //   this.overlayCanvas.nativeElement,
      //   resizedDetections
      // );
      // Draw additional information
      resizedDetections.forEach((detection: any) => {
        const { age, gender, genderProbability } = detection;
        const text = `Age: ${Math.round(age)} - Gender: ${gender} (${Math.round(
          genderProbability * 100
        )}%)`;
        const box = detection.detection.box;
        const drawBox = new faceapi.draw.DrawBox(box, { label: text });
        drawBox.draw(this.overlayCanvas.nativeElement);
      });
    }
  }

  private createImageFromWebcamImage(
    webcamImage: WebcamImage
  ): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = webcamImage.imageAsDataUrl;
      img.onload = () => resolve(img);
      img.onerror = reject;
    });
  }

  public cameraWasSwitched(deviceId: string): void {
    console.log('active device: ' + deviceId);
    this.deviceId = deviceId;
  }

  public get triggerObservable(): Observable<void> {
    return this.trigger.asObservable();
  }

  public get nextWebcamObservable(): Observable<boolean | string> {
    return this.nextWebcam.asObservable();
  }

  onFileSelected(event: Event): void {
    const element = event.currentTarget as HTMLInputElement;
    let file: File | null = element.files ? element.files[0] : null;
  
    if (file) {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        // Create an HTMLImageElement from the uploaded file
        const image = new Image();
        image.onload = async () => {
          // Ensure the canvas is the same size as the image
          if (this.overlayCanvas) {
            // this.overlayCanvas.nativeElement.width = image.width;
            // this.overlayCanvas.nativeElement.height = image.height;
            this.overlayCanvas.nativeElement.height = 300;
            // Draw the image onto the canvas
            const ctx = this.overlayCanvas.nativeElement.getContext('2d');
            ctx?.drawImage(image, 0, 0);
  
            // Now the image is loaded and displayed, automatically trigger the analysis
            await this.analyzeImage(image);
          }
        };
  
        // Set the image source to the result from the FileReader
        // This will also trigger the onload function above once the image is loaded
        image.src = e.target.result;
  
        // Set the Data URL for displaying the image via <img> tag if needed
        this.webcamImage = undefined;
        this.uploadedImageDataUrl = e.target.result;
      };
  
      // Read the file as a Data URL
      reader.readAsDataURL(file);
    }
  }
  

  // Analyze the image using face-api.js
  async analyzeImage(image: HTMLImageElement): Promise<void> {
    this.isAnalyzing = true;
    const detections = await faceapi
      .detectAllFaces(image, new faceapi.SsdMobilenetv1Options())
      .withFaceLandmarks()
      .withFaceDescriptors()
      .withAgeAndGender();
    console.log(detections);
    this.isAnalyzing = false;
    // Draw the facial recognition results onto the canvas
    this.drawDetections(detections);
  }
}
